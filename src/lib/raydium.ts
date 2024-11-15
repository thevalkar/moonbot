import {
  TransactionMessage,
  VersionedTransaction,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js"

import {
  LIQUIDITY_STATE_LAYOUT_V4,
  LiquidityPoolKeys,
  MARKET_STATE_LAYOUT_V3,
  Market,
  Liquidity,
  Percent,
  SPL_ACCOUNT_LAYOUT,
  TOKEN_PROGRAM_ID,
  Token,
  TokenAmount,
  LiquidityPoolInfo,
} from "@raydium-io/raydium-sdk"
import { getWalletTokenBalance, sendAndRetryTransaction } from "./utils"
import chalk from "chalk"

const jitoPayerKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(process.env.JITO_PAYER_KEYPAIR as string))
)

export const getBuyRaydiumTokenTransaction = async (
  connection: Connection,
  keypair: Keypair,
  tokenMint: string,
  poolId: string,
  amountInSol: number = 0.01,
  poolKeys?: Awaited<ReturnType<typeof fetchPoolAndMarketAccounts>>["poolKeys"]
) => {
  let tries = 1

  while (tries < 5) {
    try {
      const balance = await getWalletTokenBalance(
        connection,
        keypair.publicKey,
        new PublicKey(tokenMint)
      )

      if (balance?.value.uiAmount) {
        console.log(`Wallet ${keypair.publicKey.toString()} already has balance for ${tokenMint}`)
        break
      }

      if (!poolKeys) {
        try {
          poolKeys = (await fetchPoolAndMarketAccounts(connection, poolId))
            .poolKeys
        } catch (e) {
          console.error(e)
        }

        if (!poolKeys) {
          console.error("Couldn't find pool keys or info.")
          return false
        }
      }

      console.log(
        `${chalk.green(
          "[SNIPING_BOT]"
        )} Attempt ${tries} to buy ${tokenMint} for ${keypair.publicKey.toString()} | ${new Date().toUTCString()}`
      )

      const ixsRes = await getSwapInstructions(
        connection,
        keypair,
        poolKeys,
        "buy",
        amountInSol,
        51
      )

      if (!ixsRes) {
        throw new Error("No swap instructions found")
      }

      let latestBlockHash = await connection.getLatestBlockhashAndContext(
        "confirmed"
      )

      const ixs = [...ixsRes.instructions]


      const feesWallet = jitoPayerKeypair.publicKey

      ixs.push(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: feesWallet,
          lamports: 0.000725 * 1e9,
        })
      )

      const versionedTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: keypair.publicKey,
          recentBlockhash: latestBlockHash.value.blockhash,
          instructions: ixs,
        }).compileToV0Message()
      )

      versionedTransaction.sign([keypair])

      return versionedTransaction.serialize()
    } catch (e) {
      console.log(e)
      tries++
    }
  }
}

export const fetchPoolAndMarketAccounts = async (
  connection: Connection,
  poolId: string
) => {
  let pool: ReturnType<typeof LIQUIDITY_STATE_LAYOUT_V4.decode> | undefined =
    undefined,
    market: MarketData | undefined = undefined
  let error: boolean | string = true
  let retries = 0
  const MAX_RETRIES = 30

  while (error && retries < MAX_RETRIES) {
    try {
      const poolAccountInfo = await connection.getAccountInfo(
        new PublicKey(poolId)
      )

      if (!poolAccountInfo) throw new Error("Pool account not found")

      pool = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccountInfo.data)
      const { marketId } = pool

      const marketAccountInfo = await connection.getAccountInfo(
        new PublicKey(marketId)
      )

      if (!marketAccountInfo) throw new Error("Market account not found")

      market = MARKET_STATE_LAYOUT_V3.decode(marketAccountInfo.data)

      market.marketAuthority = Market.getAssociatedAuthority({
        programId: marketAccountInfo?.owner,
        marketId: new PublicKey(marketId),
      }).publicKey.toString()
      error = false
    } catch (e: any) {
      error = e
      retries++
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }

  if (!pool || !market) throw new Error("Pool or market accounts not found")

  const poolKeys = getPoolKeysFromAccountsData(poolId, pool, market)

  return { poolKeys, pool, market }
}

export const fetchPoolInfo = async (
  connection: Connection,
  poolKeys: LiquidityPoolKeys
) => {
  let poolInfo: LiquidityPoolInfo | undefined = undefined
  let error: boolean | string = true
  let retries = 0
  const MAX_RETRIES = 5

  while (error && retries < MAX_RETRIES) {
    try {
      poolInfo = await Liquidity.fetchInfo({ connection, poolKeys })

      error = false
    } catch (e: any) {
      error = e
      retries++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  if (!poolInfo) throw new Error("Pool info not found")

  return poolInfo
}

// This is necessary because Raydium library sucks.
export const getPoolKeysFromAccountsData = (
  poolId: string,
  pool: ReturnType<typeof LIQUIDITY_STATE_LAYOUT_V4.decode>,
  market: MarketData
) => {
  const { marketId } = pool
  const poolKeys = {
    id: new PublicKey(poolId),
    baseMint: pool.baseMint,
    quoteMint: pool.quoteMint,
    lpMint: pool.lpMint,
    baseDecimals: Number(pool.baseDecimal.toString().slice(0, 9)),
    quoteDecimals: Number(pool.quoteDecimal.toString().slice(0, 9)),
    lpDecimals: Number(pool.baseDecimal.toString().slice(0, 9)),
    version: 4 as 4,
    programId: new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
    authority: new PublicKey("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"),
    openOrders: pool.openOrders,
    targetOrders: pool.targetOrders,
    baseVault: pool.baseVault,
    quoteVault: pool.quoteVault,
    withdrawQueue: new PublicKey("11111111111111111111111111111111"),
    lpVault: new PublicKey("11111111111111111111111111111111"),
    marketVersion: 3 as 3,
    marketProgramId: new PublicKey(
      "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"
    ),
    marketId: new PublicKey(marketId),
    marketAuthority: new PublicKey(!market.marketAuthority),
    marketBaseVault: market.baseVault,
    marketQuoteVault: market.quoteVault,
    marketBids: market.bids,
    marketAsks: market.asks,
    marketEventQueue: market.eventQueue,
    lookupTableAccount: new PublicKey("11111111111111111111111111111111"),
  }

  return poolKeys
}

export async function calcAmountOut(
  connection: Connection,
  poolKeys: Awaited<ReturnType<typeof fetchPoolAndMarketAccounts>>["poolKeys"],
  rawAmountIn: number,
  currencyInMint: PublicKey,
  currencyOutMint: PublicKey,
  slippage = 50
) {
  const liquidityPoolInfo = await Liquidity.fetchInfo({ connection, poolKeys })
  let currencyInDecimals =
    currencyInMint.toString() === poolKeys.baseMint.toString()
      ? liquidityPoolInfo.baseDecimals
      : liquidityPoolInfo.quoteDecimals
  let currencyOutDecimals =
    currencyOutMint.toString() === poolKeys.baseMint.toString()
      ? liquidityPoolInfo.baseDecimals
      : liquidityPoolInfo.quoteDecimals

  const currencyIn = new Token(
    new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
    currencyInMint,
    currencyInDecimals
  )
  const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)

  const currencyOut = new Token(
    new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
    currencyOutMint,
    currencyOutDecimals
  )
  const slippagePercent = new Percent(slippage, 100)

  const {
    amountOut,
    minAmountOut,
    currentPrice,
    executionPrice,
    priceImpact,
    fee,
  } = Liquidity.computeAmountOut({
    poolKeys,
    poolInfo: liquidityPoolInfo,
    amountIn,
    currencyOut,
    slippage: slippagePercent,
  })

  return {
    amountIn,
    amountOut,
    minAmountOut,
    currentPrice,
    executionPrice,
    priceImpact,
    fee,
    currencyInMint,
    currencyOutMint,
    poolInfo: liquidityPoolInfo,
  }
}

export const getOwnerTokenAccounts = async (
  connection: Connection,
  publicKey: PublicKey
) => {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(
    publicKey,
    {
      programId: TOKEN_PROGRAM_ID,
    }
  )

  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }))
}

export const SOL_MINT = "So11111111111111111111111111111111111111112"

// Computes amount out and makes instructions
export const getSwapInstructions = async (
  connection: Connection,
  keypair: Keypair,
  poolKeys: Awaited<ReturnType<typeof fetchPoolAndMarketAccounts>>["poolKeys"],
  swapType: "buy" | "sell" = "buy",
  amount = 0.001,
  slippage?: number,
  feesInSol?: number
) => {
  // Determine the currency in and out. "in" means we're buying the token with SOL, "out" means we're selling the token for SOL
  let currencyInMint: PublicKey, currencyOutMint: PublicKey
  const isBaseSol = poolKeys.baseMint.toString() === SOL_MINT

  switch (swapType) {
    case "buy":
      currencyInMint = new PublicKey(SOL_MINT)
      currencyOutMint = isBaseSol ? poolKeys.quoteMint : poolKeys.baseMint

      break
    case "sell":
      currencyInMint = isBaseSol ? poolKeys.quoteMint : poolKeys.baseMint
      currencyOutMint = new PublicKey(SOL_MINT)

      break
  }

  let error: boolean | string = true
  let retries = 0
  const MAX_RETRIES = swapType === "sell" ? 1 : 5

  while (error && retries < MAX_RETRIES) {
    try {
      const { amountIn, minAmountOut, currentPrice } = await calcAmountOut(
        connection,
        poolKeys,
        amount,
        currencyInMint,
        currencyOutMint,
        slippage || swapType === "buy" ? 51 : 11
      )

      if (Number(minAmountOut.toExact()) <= 0) {
        throw new Error("Not swapping: No min amount out")
      }

      const tokenAccounts = await getOwnerTokenAccounts(
        connection,
        keypair.publicKey
      )
      const swapTransaction = await Liquidity.makeSwapInstructionSimple({
        connection: connection,
        makeTxVersion: 1,
        poolKeys,
        userKeys: {
          tokenAccounts,
          owner: keypair.publicKey,
        },
        amountIn: amountIn,
        amountOut: minAmountOut,
        // in means quote is the destination token, and base is SOL. out means quote is SOL and base is the destination token
        // fixedSide: isBaseSol ? "in" : "out",
        fixedSide: "in",
        config: {
          bypassAssociatedCheck: false,
        },
        computeBudgetConfig: {
          microLamports: (feesInSol || 0.000011) * 10 ** 9,
        },
      })

      const instructions =
        swapTransaction.innerTransactions[0].instructions.filter(Boolean)

      error = false

      return { instructions, minAmountOut, currentPrice }
    } catch (e: any) {
      console.error(e)
      error = e
      retries++
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  if (error) {
    throw new Error(`Failed to ${swapType}. ` + error)
  }
}

export type MarketData = ReturnType<typeof MARKET_STATE_LAYOUT_V3.decode> & {
  marketAuthority?: string
}
