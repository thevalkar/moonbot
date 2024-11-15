import {
  MintLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token"
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  ParsedAccountData,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
  RpcResponseAndContext,
  TokenAmount,
  VersionedTransaction,
} from "@solana/web3.js"

import {
  jsonInfo2PoolKeys,
  LIQUIDITY_STATE_LAYOUT_V4,
} from "@raydium-io/raydium-sdk"
import { writeFileSync, readFileSync, readdirSync } from "fs"
import BN from "bn.js"
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor"
import idl from "../data/pumpfun-idl.json"
import {
  fetchDigitalAsset,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata"
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults"
import { publicKey } from "@metaplex-foundation/umi"
import { insertToken } from "./postgres"
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet"
import example from "@/data/example-pumpfun-swap.json"
import exampleTokenTx from "@/data/example-token-tx.json"
import chalk from "chalk"
import { token } from "@coral-xyz/anchor/dist/cjs/utils"
import crypto from "crypto"
import dotenv from "dotenv"
import { SOL_MINT } from "./raydium"
dotenv.config()

export const PUMPFUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
export const RAYDIUM_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
export const MOONSHOT_PROGRAM_ID = "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG"

export const heliusRpcUrl = process.env.HELIUS_RPC_URL as string

const umi = createUmi(heliusRpcUrl).use(mplTokenMetadata())

const encryptionKey = Buffer.from(
  process.env.KEYPAIR_ENCRYPTION_KEY as string,
  "hex"
)
const iv = Buffer.from(process.env.KEYPAIR_ENCRYPTION_IV as string, "hex")

export async function encrypt(text: string) {
  const cipher = crypto.createCipheriv("aes-256-cbc", encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()])
  return iv.toString("hex") + ":" + encrypted.toString("hex")
}

export async function decrypt(text: string) {
  const [ivHex, encryptedText] = text.split(":")
  const ivBuffer = Buffer.from(ivHex, "hex")
  const encryptedBuffer = Buffer.from(encryptedText, "hex")
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    encryptionKey,
    ivBuffer
  )
  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ])
  return decrypted.toString("utf8")
}

export function findTokenMintAddressFromTransaction(
  transactionData: ParsedTransactionWithMeta
): string | null {
  if (!transactionData.meta) return null

  const { innerInstructions, postTokenBalances } = transactionData.meta

  if (!innerInstructions) return null

  // Helper function to find the mint address from postTokenBalances
  const findMintFromBalances = (): string | null => {
    if (!postTokenBalances) return null
    for (const balance of postTokenBalances) {
      if (
        balance.uiTokenAmount.amount !== "0" &&
        balance.mint !== "So11111111111111111111111111111111111111112"
      ) {
        return balance.mint
      }
    }
    return null
  }

  for (const instructionGroup of innerInstructions) {
    for (const instruction of instructionGroup.instructions) {
      const parsed = (instruction as ParsedInstruction).parsed
      if (!parsed) continue

      if (
        parsed.type === "initializeAccount" ||
        parsed.type === "initializeAccount3"
      ) {
        const { mint } = parsed.info
        if (mint && mint !== "So11111111111111111111111111111111111111112") {
          return mint
        }
      }

      if (parsed.type === "transfer") {
        const { destination } = parsed.info
        if (destination) {
          const mint = findMintFromBalances()
          if (mint && mint !== "So11111111111111111111111111111111111111112") {
            return mint
          }
        }
      }
    }
  }

  // If no mint address is found in the instructions, check postTokenBalances
  return findMintFromBalances()
}

export function getTokenPriceInSolFromTransaction(
  transactionData: ParsedTransactionWithMeta,
  // Wheter to account for sales. If false, it will only return the price if the wallet is buying tokens.
  accountForSales: boolean = false
) {
  const isDexSwap = isTransactionDexSwap(transactionData)
  if (!isDexSwap || !transactionData.meta) return null
  const {
    preBalances,
    postBalances,
    preTokenBalances,
    postTokenBalances,
    innerInstructions,
  } = transactionData.meta
  const {
    transaction: {
      message: { instructions },
    },
  } = transactionData

  // Find the mint address to focus on the specific token
  const tokenMintAddress = findTokenMintAddressFromTransaction(transactionData)

  if (!tokenMintAddress) return null

  // Filter out if the wallet is sending coins to another wallet. It's not a purchase.
  const signerWallet = transactionData.transaction.message.accountKeys[0].pubkey
  const tokenAta = getAssociatedTokenAddressSync(
    new PublicKey(tokenMintAddress),
    new PublicKey(signerWallet)
  )

  const isTokenTransfer = instructions.some(
    (ix) =>
      (ix as ParsedInstruction).parsed?.info?.source === tokenAta.toString() &&
      (ix as ParsedInstruction).parsed?.info?.mint === tokenMintAddress
  )

  if (isTokenTransfer) return null

  // Check if any other token was used in the transaction
  const otherTokenUsed = preTokenBalances?.some((preBalance, index) => {
    const postBalance = postTokenBalances?.find(
      (postBalance) => postBalance.mint === preBalance.mint
    )
    if (!postBalance) return false
    const preAmount = Number(preBalance.uiTokenAmount.uiAmount)
    const postAmount = Number(postBalance.uiTokenAmount.uiAmount)
    return (
      preAmount !== postAmount &&
      preBalance.mint !== tokenMintAddress &&
      preBalance.mint !== "So11111111111111111111111111111111111111112"
    )
  })

  if (otherTokenUsed) return null

  let solSpent

  if (innerInstructions) {
    for (const innexIxs of innerInstructions) {
      for (const instruction of innexIxs.instructions) {
        const parsed = (instruction as ParsedInstruction).parsed
        if (!parsed) continue

        if (
          instruction.programId.toString() === TOKEN_PROGRAM_ID.toString() &&
          parsed.info.authority === signerWallet.toString() &&
          parsed.type === "transfer"
        ) {
          const amount = Number(parsed.info.amount) / 1e9

          solSpent = amount
        }
      }
    }
  }

  if (!solSpent) {
    solSpent = (preBalances[0] - postBalances[0]) / 1000000000 // Convert lamports to SOL
  }

  // Get SOL spent by comparing pre and post balances of the main account

  // Get the token amount received by comparing pre and post token balances
  let tokensReceived = 0

  if (!postTokenBalances) return null
  for (let i = 0; i < postTokenBalances.length; i++) {
    if (
      postTokenBalances[i].mint === tokenMintAddress &&
      postTokenBalances[i].owner === signerWallet.toString()
    ) {
      if (!preTokenBalances) continue
      const preTokenBalance = preTokenBalances.find(
        (balance) =>
          balance.mint === tokenMintAddress &&
          balance.owner === signerWallet.toString()
      )
      const preAmount = preTokenBalance
        ? Number(preTokenBalance.uiTokenAmount.uiAmount)
        : 0
      const postAmount = Number(postTokenBalances[i].uiTokenAmount.uiAmount)
      tokensReceived = postAmount - preAmount
      break
    }
  }

  if (!accountForSales) {
    if (tokensReceived <= 0) return null
  }

  // Calculate the price per token in SOL
  const pricePerToken = solSpent / tokensReceived
  return { solSpent, pricePerToken, tokensReceived }
}

export function isTransactionDexSwap(tx: ParsedTransactionWithMeta) {
  const raydiumIx = tx.transaction.message.accountKeys.find(
    (key) =>
      key.pubkey.toString() === "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
  )

  const pumpIx = tx.transaction.message.accountKeys.find(
    (key) =>
      key.pubkey.toString() === "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
  )

  const jupIx = tx.transaction.message.accountKeys.find(
    (key) =>
      key.pubkey.toString() === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
  )

  const moonshotIx = tx.transaction.message.accountKeys.find(
    (key) =>
      key.pubkey.toString() === "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG"
  )

  const meteoraIx = tx.transaction.message.accountKeys.find(
    (key) =>
      key.pubkey.toString() === "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB"
  )

  return !!raydiumIx || !!pumpIx || !!jupIx || !!moonshotIx || !!meteoraIx
}

export const getTokensTransactionsFromFiles = (tokensFilter?: string[]) => {
  const files = readdirSync("./transactions/")
  const transactionsFiles = files.filter(
    (file) => file.indexOf("transactions") > -1
  )

  const transactionsPerToken: {
    [token: string]: (typeof exampleTokenTx)[]
  } = {}
  for (const file of transactionsFiles) {
    if (!file.match(/^[a-zA-Z0-9]+-transactions\.json$/)) continue
    const path = `./transactions/${file}`
    const token = file.split("-")[0]
    if (tokensFilter && !tokensFilter.includes(token)) continue
    const content = JSON.parse(readFileSync(path, "utf-8"))
    console.log(path)
    transactionsPerToken[token] = content
  }

  // Heap memory
  // writeFileSync(
  //   "./data/transactionsPerToken.json",
  //   JSON.stringify(transactionsPerToken, null, 2)
  // )

  return transactionsPerToken
}

export const getSolanaPrice = async () => {
  const priceRes = (await (
    await fetch(
      "https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
    )
  ).json()) as {
    parsed: {
      price: {
        price: string
      }
    }[]
  }

  const solanaPrice = Number(priceRes.parsed[0].price.price) / 1e8

  return solanaPrice
}

export const getTransactionDataFromWebhookTransaction = (
  transaction: typeof example
) => {
  const pumpFunIx = getTransactionInstructionByProgramId(
    transaction,
    PUMPFUN_PROGRAM_ID
  )

  const raydiumIx = getTransactionInstructionByProgramId(
    transaction,
    RAYDIUM_PROGRAM_ID
  )

  const moonshotIx = getTransactionInstructionByProgramId(
    transaction,
    MOONSHOT_PROGRAM_ID
  )

  const programIx = pumpFunIx || raydiumIx || moonshotIx

  if (!programIx)
    throw new Error("Program instruction not found " + transaction.signature)

  const tokenVault =
    pumpFunIx || moonshotIx ? programIx.accounts[3] : programIx.accounts[5]

  const payer = transaction.feePayer

  const { tokenTransfers, nativeTransfers } = transaction

  let isBuy = false,
    isSell = false,
    tokenMint,
    tokenAmount,
    solAmount

  for (const transfer of tokenTransfers) {
    const isSol = transfer.mint === SOL_MINT
    const isToUser = transfer.toUserAccount === payer
    const isFromUser = transfer.fromUserAccount === payer
    let isToVault, isFromVault

    if (raydiumIx) {
      isToVault = transfer.toUserAccount === RAYDIUM_AUTHORITY
      isFromVault = transfer.fromUserAccount === RAYDIUM_AUTHORITY
    } else {
      isToVault = transfer.toUserAccount === tokenVault
      isFromVault = transfer.fromUserAccount === tokenVault
    }

    if (
      !isSol &&
      !tokenMint &&
      ((isFromUser && isToVault) || (isFromVault && isToUser))
    ) {
      tokenMint = transfer.mint
    }

    if (
      !tokenAmount &&
      !isSol &&
      isToUser &&
      transfer.mint === tokenMint &&
      isFromVault
    ) {
      isBuy = true
      tokenAmount = transfer.tokenAmount
    } else if (!solAmount && isSol && isToUser && isFromVault) {
      isSell = true
      solAmount = transfer.tokenAmount
    } else if (!solAmount && isSol && isFromUser && isToVault) {
      isBuy = true
      solAmount = transfer.tokenAmount
    } else if (
      !tokenAmount &&
      !isSol &&
      isFromUser &&
      transfer.mint === tokenMint &&
      isToVault
    ) {
      isSell = true
      tokenAmount = transfer.tokenAmount
    }
  }

  if (!solAmount && pumpFunIx) {
    const bondingCurveSolChange = transaction.accountData.find(
      (accData) => accData.account === tokenVault && accData.nativeBalanceChange
    )?.nativeBalanceChange
    solAmount = bondingCurveSolChange ? bondingCurveSolChange / 1e9 : undefined
  }

  if (solAmount && tokenAmount && tokenMint) {
    const price = Math.abs(solAmount) / Math.abs(tokenAmount)

    return {
      solAmount: Math.abs(solAmount),
      tokenAmount: Math.abs(tokenAmount),
      tokenMint,
      isBuy,
      isSell,
      tokenVault,
      price,
    }
  } else {
    console.log(
      "Price not found",
      transaction.signature,
      tokenMint,
      "solAmount",
      solAmount,
      "tokenAmount",
      tokenAmount,
      isBuy,
      isSell
    )
    return
  }
}

export const getTransactionInstructionByProgramId = (
  tx: typeof example,
  programId: string
) => {
  let instruction
  instruction = tx.instructions.find((ix) => ix.programId === programId)

  if (!instruction) {
    tx.instructions.forEach((ix) => {
      if (ix.innerInstructions) {
        const found = ix.innerInstructions.find(
          (innerIx) => innerIx.programId === programId
        )
        if (found) instruction = found
      }
    })
  }

  return instruction
}

// @TODO there MUST be a better way to find price for a token.
export const getTokenPrice = async (
  connection: Connection,
  mint: string,
  pairAddress: string
) => {
  let tokenPriceInSol
  let tries = 1

  while (!tokenPriceInSol && tries < 5) {
    try {
      const raydiumPrice = await getRaydiumTokenPrice(
        connection,
        new PublicKey(pairAddress)
      )

      if (raydiumPrice) {
        tokenPriceInSol = raydiumPrice
      }
    } catch (e) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      try {
        const pumpFunPrice = await getPumpFunTokenPrice(pairAddress)

        if (pumpFunPrice) {
          tokenPriceInSol = Number(pumpFunPrice.price.toFixed(9))
        }
      } catch (e) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } finally {
      tries++
      await new Promise((resolve) => setTimeout(resolve, 1000))

      if (tries === 5)
        throw new Error(
          chalk.red(`Price not found for token ${mint} after 5 tries.`)
        )
    }
  }

  return tokenPriceInSol
}

export const getTokenPairAddressAndAsset = async (
  tokenMint: string,
  fetchAsset = false
) => {
  try {
    let pairAddress

    // Try raydium first. If the token is from Pump.fun, we don't want to save the Pump.fun pair address, because it will only have the pump.fun liquidity.
    const apiRes = await fetch(
      "https://api.dexscreener.com/latest/dex/tokens/" + tokenMint
    )

    if (apiRes.ok) {
      const { pairs }: { pairs: PairData[] } = await apiRes.json()

      const raydiumPair = pairs?.find((pair) => pair.dexId === "raydium")

      if (raydiumPair) {
        const {
          priceNative,
          pairAddress: raydiumPairAddress,
          liquidity: { usd },
        } = raydiumPair

        pairAddress = raydiumPairAddress
      }
    } else {
      console.log(
        chalk.red("Dexscreener API error:"),
        await apiRes.text(),
        token
      )
      if (apiRes.status === 429) {
        throw new Error(chalk.red("Dexscreener API error: Rate limit reached."))
      }
    }

    // Try pump.fun if raydium didn't work
    if (!pairAddress) {
      const res = await fetch(
        `https://frontend-api.pump.fun/coins/${tokenMint}`
      )

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error(chalk.red("Pump.fun API error: Rate limit reached."))
        }
        throw new Error(chalk.red("Pump.fun API response not ok"))
      }

      const { associated_bonding_curve, bonding_curve } = await res.json()

      if (!bonding_curve) {
        throw new Error(
          chalk.red("Pump.fun API response, but no bonding curve found")
        )
      }

      pairAddress = bonding_curve
    }

    if (pairAddress) {
      let asset
      if (fetchAsset) {
        asset = await fetchMintAsset(tokenMint)
        if (!asset) throw new Error("Digital Asset not found")
      }

      return {
        tokenMint,
        asset,
        pairAddress,
      }
    } else {
      throw `${chalk.red(
        "No API response and no bonding curve"
      )} for ${tokenMint}: No API Response and no bonding curve`
    }
  } catch (e) {
    throw e
  }
}

export const fetchMintAsset = async (
  mint: string,
  fetchOffchainJson: boolean = false
) => {
  let withMetadata
  const maxRetries = 5
  let retries = 0
  let error

  while (!withMetadata && retries < maxRetries) {
    try {
      const asset = await fetchDigitalAsset(umi, publicKey(mint))

      if (fetchOffchainJson) {
        const res = await fetch(asset.metadata.uri)
        if (!res.ok)
          throw new Error(
            "Offchain metadata not found " + mint + ` ${asset.metadata.uri}`
          )

        const metadata: Metadata = await res.json()

        withMetadata = {
          ...asset,
          metadata: {
            ...asset.metadata,
            offchain: metadata,
          },
        }
      } else {
        withMetadata = asset
      }
    } catch (e) {
      retries++
      console.log("Retrying...")
      await new Promise((resolve) => setTimeout(resolve, 1500))
      if (retries === maxRetries) {
        console.log("Max retries reached, asset not found" + e)
        error = e
      }
    }
  }

  if (!withMetadata) throw error

  return withMetadata
}

type Metadata = {
  name: string
  symbol: string
  description: string
  image: string
  showName: string
  createdOn: string
  telegram: string
  twitter: string
}

const pumpFunProgram = new Program(
  idl as Idl,
  new PublicKey(PUMPFUN_PROGRAM_ID),
  new AnchorProvider(
    new Connection(heliusRpcUrl),
    new NodeWallet(Keypair.generate()),
    {}
  )
)

export const getPumpFunTokenPrice = async (
  bondingCurve: string,
  program: Program = pumpFunProgram
) => {
  const bondingCurveData = (await program.account.bondingCurve.fetch(
    bondingCurve
  )) as {
    virtualTokenReserves: BN
    virtualSolReserves: BN
  }

  const decimals = 6
  const virtualTokenReserves = bondingCurveData.virtualTokenReserves.toNumber()
  const virtualSolReserves = bondingCurveData.virtualSolReserves.toNumber()

  const parsedVirtualTokenReserves = virtualTokenReserves / 10 ** decimals
  const parsedVirtualSolReserves = virtualSolReserves / LAMPORTS_PER_SOL

  const price = parsedVirtualSolReserves / parsedVirtualTokenReserves

  return { price, solReserve: parsedVirtualSolReserves }
}

export const RAYDIUM_AUTHORITY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"

export const getMintData = async (
  connection: Connection,
  mint: PublicKey,
  vault: string
) => {
  const token = await connection.getAccountInfo(mint)
  if (!token) throw new Error("Token not found")
  const parsed = MintLayout.decode(token.data)

  const isRenounced = !parsed.mintAuthorityOption
  const tokenSupply = await connection.getTokenSupply(mint)

  const largest = await connection.getTokenLargestAccounts(mint)

  const accountInfos = await connection.getMultipleParsedAccounts(
    largest.value.slice(0, 5).map((acc) => acc.address),
    {
      commitment: "confirmed",
    }
  )

  let lpSupply: number | undefined = undefined

  // Figure out how many tokens percentage the top 5 holders hold
  const topFiveHoldersHold = largest.value
    .slice(0, 6)
    .reduce((acc, curr, index) => {
      const accountInfo = accountInfos.value[index]

      if (!accountInfo) return acc
      const owner = (accountInfo.data as ParsedAccountData).parsed.info.owner

      if (owner === vault && curr.uiAmount) {
        lpSupply = curr.uiAmount

        return acc
      }

      return curr.uiAmount
        ? acc + curr.uiAmount
        : acc + Number(curr.amount) / 10 ** curr.decimals
    }, 0)

  const topFivePercentage =
    (topFiveHoldersHold * 100) / Number(tokenSupply.value.uiAmount)

  const lpPercentage = (lpSupply! * 100) / Number(tokenSupply.value.uiAmount)

  return {
    topFivePercentage,
    isRenounced,
    tokenSupply,
    lpSupply,
    lpPercentage,
  }
}

export async function getRaydiumTokenPrice(
  connection: Connection,
  pairAddress: PublicKey = new PublicKey(
    "2STjwk3LhwGT6T57RfiX381A4bDxcnTx7b6Mg6yLEC9m"
  )
) {
  const poolAccountInfo = await connection.getAccountInfo(
    new PublicKey(pairAddress)
  )

  if (!poolAccountInfo) throw new Error("Invalid pair address")

  const pool = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccountInfo.data)

  if (!pool) throw new Error("Pool account not found")

  const { baseVault, baseMint, quoteVault, quoteMint } = pool

  const [quoteReserve, baseReserve] = await Promise.all([
    connection.getTokenAccountBalance(quoteVault),
    connection.getTokenAccountBalance(baseVault),
  ])

  if (!quoteReserve || !quoteReserve) {
    throw new Error("Could not find token account balance for pool reserves")
  }

  if (!quoteReserve.value.uiAmount || !baseReserve.value.uiAmount) {
    throw new Error("Reserve token accounts found but no uiAmount")
  }
  const price =
    baseMint.toString() === SOL_MINT
      ? baseReserve.value.uiAmount / quoteReserve.value.uiAmount
      : quoteReserve.value.uiAmount / baseReserve.value.uiAmount

  const toFixed = Number(price.toFixed(9))

  return toFixed
}

export interface DasApiTokenResponse {
  interface: "FungibleToken"
  id: string
  content: {
    $schema: string
    json_uri: string
    files: [object] // You might want to define a more specific type for files
    metadata: {
      description: string
      name: string
      symbol: string
      token_standard: string
    }
    links: {
      image: string
    }
  }
  authorities: [
    {
      address: string
      scopes: string[]
    }
  ]
  compression: {
    eligible: boolean
    compressed: boolean
    data_hash: string
    creator_hash: string
    asset_hash: string
    tree: string
    seq: number
    leaf_id: number
  }
  grouping: any[] // You might want to define a more specific type for grouping
  royalty: {
    royalty_model: string
    target: null
    percent: number
    basis_points: number
    primary_sale_happened: boolean
    locked: boolean
  }
  creators: any[] // You might want to define a more specific type for creators
  ownership: {
    frozen: boolean
    delegated: boolean
    delegate: null
    ownership_model: string
    owner: string
  }
  supply: null
  mutable: boolean
  burnt: boolean
  token_info: {
    supply: number | null
    decimals: number
    token_program: string
  }
}

export const getAssetData = async (id: string) => {
  const response = await fetch(heliusRpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "my-id",
      method: "getAsset",
      params: {
        id,
        displayOptions: {
          showFungible: true, //return details about a fungible token
        },
      },
    }),
  })
  const { result } = await response.json()

  return result as DasApiTokenResponse
}

export const getWalletTokenBalance = async (
  connection: Connection,
  publicKey: PublicKey,
  mint: PublicKey
) => {
  let tokenAccount: PublicKey | undefined = undefined,
    balance: RpcResponseAndContext<TokenAmount> | undefined = undefined

  let error: boolean | string = true
  let retries = 0
  const MAX_RETRIES = 10

  while (error && retries < MAX_RETRIES) {
    try {
      tokenAccount = await getAssociatedTokenAddress(mint, publicKey)
      balance = await connection.getTokenAccountBalance(tokenAccount)
      error = false
    } catch (e: any) {
      error = e
      retries++
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  return balance
}

// @ts-ignore
BigInt.prototype["toJSON"] = function () {
  return parseInt(this.toString())
}

export const sendAndRetryTransaction = async (
  connection: Connection,
  transaction: Uint8Array,
) => {
  let blockHeight
  let txid
  let confirmed = false

  const blockhashAndContext = await connection.getLatestBlockhashAndContext("processed")

  try {
    blockHeight = await connection.getBlockHeight("processed")
    txid = await connection.sendRawTransaction(transaction, {
      skipPreflight: true,
      preflightCommitment: "processed",
      // minContextSlot: blockhashAndContext.context.slot,
      // maxRetries: 0,
    })

    connection
      .confirmTransaction(txid, "processed")
      .then(() => {
        confirmed = true
      })
      .catch((e) => { })
  } catch (e) {
    console.error(e)

    return {}
  }

  while (
    blockHeight < blockhashAndContext.value.lastValidBlockHeight &&
    !confirmed
  ) {
    try {
      txid = await connection.sendRawTransaction(transaction, {
        skipPreflight: true,
        preflightCommitment: "processed",
        // minContextSlot: blockhashAndContext.context.slot,
        // maxRetries: 0,
      })
      blockHeight = await connection.getBlockHeight("processed")
      await new Promise(resolve => setTimeout(resolve, 2500))
    } catch (e) { }
  }

  return { txid }
}

type TokenInfo = {
  address: string
  name: string
  symbol: string
}

type TxnsData = {
  buys: number
  sells: number
}

type VolumeData = {
  h24: number
  h6: number
  h1: number
  m5: number
}

type PriceChangeData = {
  m5: number
  h1: number
  h6: number
  h24: number
}

type LiquidityData = {
  usd: number
  base: number
  quote: number
}

type Website = {
  label: string
  url: string
}

type Social = {
  type: string
  url: string
}

type TokenImage = {
  imageUrl: string
  websites: Website[]
  socials: Social[]
}

export type PairData = {
  chainId: string
  dexId: string
  url: string
  pairAddress: string
  baseToken: TokenInfo
  quoteToken: TokenInfo
  priceNative: string
  priceUsd: string
  txns: {
    m5: TxnsData
    h1: TxnsData
    h6: TxnsData
    h24: TxnsData
  }
  volume: VolumeData
  priceChange: PriceChangeData
  liquidity: LiquidityData
  fdv: number
  pairCreatedAt: number
  info: TokenImage
}
