import express from "express"
import chalk from "chalk"
import { Connection, PublicKey, Keypair } from "@solana/web3.js"
import { Bot } from "grammy"
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor"
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet"
import { readFileSync } from 'fs'

import examplePumpfun from "@/data/example-pumpfun-swap.json"

import { buyRaydiumToken, fetchPoolAndMarketAccounts } from "@/lib/raydium"
import {
  MOONSHOT_PROGRAM_ID,
  PUMPFUN_PROGRAM_ID,
  RAYDIUM_AUTHORITY,
  RAYDIUM_PROGRAM_ID,
  fetchMintAsset,
  getMintData,
  getTransactionInstructionByProgramId,
  getWalletTokenBalance,
  getSolanaPrice,
  getTransactionDataFromWebhookTransaction,
  heliusRpcUrl,
} from "@/lib/utils"
import sql, {
  getTokenSignals,
  insertToken,
  insertTokenEntry,
  insertTokenSignal,
  selectTokenEntriesUniqueBuyers,
} from "./lib/postgres"
import idl from "@/data/pumpfun-idl.json"
import { getBuyPumpfunTokenTransaction } from "@/lib/pumpfun"
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes"
import { decrypt } from "@/lib/utils"
import { createServer } from "https"
import { configDotenv } from "dotenv"
import { sendJitoBundle } from "./lib/jito"
import { Server } from "socket.io"
configDotenv()

const isSignaling: {
  [token: string]: boolean
} = {}
const isProcessing: {
  [token: string]: { [buyer: string]: boolean }
} = {}

const isWalletBuyingToken: {
  [transactionWallet: string]: {
    [token: string]: boolean
  }
} = {}

const MIN_BUYERS_RAYDIUM = 1
const MIN_BUYERS_PUMPFUN = 1

// Whenever a transaction happens, buy and signal a potential mooner.
const onTransactionBuyAndSignalToken = async (
  transaction: WebhookEnhancedTransaction
) => {
  console.log(
    `${chalk.blueBright(
      "Transaction"
    )} ${` https://solscan.io/tx/${transaction.signature}`} ${chalk.blueBright(
      "received"
    )}`
  )
  const data = await getParsedTokenAndTransactionDataFromTransaction(
    transaction
  )

  if (!data) return true

  const {
    transactionSource,
    tokenPrice,
    tokenVault,
    tokenPairAddress,
    tokenMint,
    transactionBuyAmount,
    transactionWallet,
    tokenTopFiveHoldersPercentage,
    tokenLpPercentage,
    tokenIsRenounced,
    tokenFdv,
    transactionTimestamp,
    tokenData,
  } = data

  const isTopFiveGood = tokenTopFiveHoldersPercentage <= 32
  const shouldCreateEntry = isTopFiveGood

  if (!shouldCreateEntry) {
    console.log(
      chalk.red("Potential rug detected") + ` tokenVault: ${tokenVault}`,
      `${tokenMint}`
    )
    return true
  }

  try {
    if (isProcessing[tokenMint]?.[transactionWallet]) {
      console.log(
        `${chalk.red(
          "[SWAP_WEBHOOK]"
        )} ${transactionWallet}/${tokenMint} is already being processed. Skipping...`
      )
      return
    } else {
      if (!isProcessing[tokenMint]) {
        isProcessing[tokenMint] = {
          [transactionWallet]: true,
        }
      } else {
        isProcessing[tokenMint][transactionWallet] = true
      }
    }

    const entry = await insertTokenEntry(
      tokenMint,
      transactionWallet,
      tokenPrice,
      transactionTimestamp,
      transactionSource,
      transactionBuyAmount,
      {
        lpPercentage: tokenLpPercentage,
        isRenounced: tokenIsRenounced,
        fdv: tokenFdv,
      }
    )

    const uniqueBuyersSqlRes = await selectTokenEntriesUniqueBuyers(tokenMint)
    const uniqueBuyersCount = Number(uniqueBuyersSqlRes.length) || 1

    console.log(
      chalk.green(`Potential mooner detected (${uniqueBuyersCount} buyers)`),
      `${tokenMint}`,

      transactionSource === "Raydium"
        ? `https://dexscreener.com/solana/${tokenMint}`
        : `https://pump.fun/${tokenMint}`,
      ` https://solscan.io/tx/${`${transaction.signature}`}`,
      new Date(Date.now()).toLocaleString()
    )

    socketConnection.emit("entry", entry)
    console.log(`${chalk.blueBright("Emitted entry")} for `, tokenMint)

    const BUYERS_AMOUNT_FOR_SIGNAL =
      transactionSource === "Raydium" ? MIN_BUYERS_RAYDIUM : MIN_BUYERS_PUMPFUN

    if (uniqueBuyersCount >= BUYERS_AMOUNT_FOR_SIGNAL) {
      // @TODO: fdv below 5000 SOL or token age is below 48h

      const shouldBuy = false
      // tokenFdv < 5000 && transactionSource === "Pumpfun"

      if (shouldBuy) {
        const codes = await sql<
          {
            // bs58 encoded keypair
            keypair: string
            code: string
            enabled: boolean
          }[]
        >`select keypair, code, enabled from moonbot_invite_codes`

        const promises = codes.map(async ({ keypair, code, enabled }) => {
          if (!enabled) return null
          try {
            const decrypted = await decrypt(keypair)
            if (!decrypted) throw new Error("Decryption failed for " + code)
            const kp = Keypair.fromSecretKey(bs58.decode(decrypted))
            return await getSnipeTransaction(kp, data)
          } catch (e) {
            console.log(`Error buying for ${code}: ` + e)
          }
          return null
        })

        const txs = (await Promise.all(promises)).filter(
          (tx): tx is Uint8Array => tx !== undefined && tx !== null
        )

        if (txs.length > 0) {
          ; (async () => {
            try {
              await sendJitoBundle(txs)
            } catch (e) {
              console.error("Error sending Jito bundle:", e)
            }
          })()
        }
      } else {
        const solanaPrice = await getSolanaPrice()
        const marketCapInUsd = solanaPrice * tokenFdv

        console.log(
          chalk.yellow(
            `Token FDV is too high (${Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(marketCapInUsd)}). Not buying.`
          )
        )
      }

      const token = await insertToken(
        tokenMint,
        tokenData,
        tokenPairAddress,
        transactionSource,
        data.tokenPumpfunBondingCurveAta
      )

      const signals = await getTokenSignals(tokenMint)
      const signalExists = signals.length > 0

      const isSignalEntry =
        !signalExists && uniqueBuyersCount >= BUYERS_AMOUNT_FOR_SIGNAL

      const buyersLastSignal =
        signals[signals.length - 1]
          ?.buyers /** Fallback for data that doesn't exist on some rows on the updated db table */ ||
        BUYERS_AMOUNT_FOR_SIGNAL

      // This is used to send signal 1 unique buyer
      const isBumpEntry = uniqueBuyersCount > buyersLastSignal

      if (
        (isSignalEntry || isBumpEntry) &&
        !isSignaling[tokenMint]
        // && tokenFdv < 5000
      ) {
        try {
          isSignaling[tokenMint] = true

          await insertTokenSignal(
            tokenMint,
            tokenPrice,
            tokenPairAddress,
            transactionTimestamp,
            transactionSource,
            uniqueBuyersCount,
            transactionWallet,
            transactionBuyAmount
          )

          const DISCORD_SHRIMP_CHANNEL_ID = "1246368892688011356"
          const DISCORD_DOLPHIN_CHANNEL_ID = "1243899842263126157"
          const DISCORD_WHALE_CHANNEL_ID = "1297547599544324107"
          const DISCORD_EXPERIMENTAL_CHANNEL_ID = "1299041170952818698"

          const TELEGRAM_SHRIMP_THREAD_ID = 7554
          const TELEGRAM_DOLPHIN_THREAD_ID = 7553
          const TELEGRAM_WHALE_THREAD_ID = 50378
          const TELEGRAM_EXPERIMENTAL_THREAD_ID = 50789

          let channelIdDiscord, threadIdTelegram

          if (tokenFdv < 1000) {
            channelIdDiscord = DISCORD_SHRIMP_CHANNEL_ID
            threadIdTelegram = TELEGRAM_SHRIMP_THREAD_ID
          } else if (tokenFdv < 6300) {
            channelIdDiscord = DISCORD_DOLPHIN_CHANNEL_ID
            threadIdTelegram = TELEGRAM_DOLPHIN_THREAD_ID
          } else {
            channelIdDiscord = DISCORD_WHALE_CHANNEL_ID
            threadIdTelegram = TELEGRAM_WHALE_THREAD_ID
          }
          await sendSocialsNotification(
            data,
            shouldBuy,
            channelIdDiscord,
            threadIdTelegram
          )
        } catch (e) {
          console.log(e)
        } finally {
          isSignaling[tokenMint] = false
        }
      }
    }
  } finally {
    if (isProcessing[tokenMint]) {
      isProcessing[tokenMint][transactionWallet] = false
    }
  }
}

const getSnipeTransaction = async (
  keypair: Keypair,
  data: Exclude<
    Awaited<ReturnType<typeof getParsedTokenAndTransactionDataFromTransaction>>,
    null
  >
) => {
  const {
    tokenMint,
    tokenRaydiumPoolKeys,
    tokenPairAddress,
    transactionSource,
    tokenPumpfunGlobalAddress,
    tokenPumpfunBondingCurveAta,
  } = data
  const walletBalance = await connection.getBalance(keypair.publicKey)

  if (walletBalance / 1e9 < 0.05) {
    console.log(
      `${chalk.red(
        "[SNIPING_BOT]"
      )} ${keypair.publicKey.toString()}: Wallet balance is too low | ${new Date().toUTCString()}`
    )
    return
  }
  // Find token account balance
  const tokenBalance = await getWalletTokenBalance(
    connection,
    keypair.publicKey,
    new PublicKey(tokenMint)
  )

  // Buy only if the wallet has no balance
  if (tokenBalance?.value.uiAmount) {
    console.log(
      `${chalk.greenBright(
        "[SNIPING_BOT]"
      )} ${keypair.publicKey.toString()}: Already has balance for ${tokenMint} | ${new Date().toUTCString()}`
    )

    return
  }

  try {
    // Make sure the token isn't being processed yet
    if (isWalletBuyingToken[keypair.publicKey.toString()]?.[tokenMint]) {
      console.log(
        `${chalk.red(
          "[SWAP_WEBHOOK]"
        )} Wallet ${keypair.publicKey.toString()} is already processing ${tokenMint}. Skipping...`
      )
      return
    } else {
      if (!isWalletBuyingToken[keypair.publicKey.toString()]) {
        isWalletBuyingToken[keypair.publicKey.toString()] = {
          [tokenMint]: true,
        }
      } else {
        isWalletBuyingToken[keypair.publicKey.toString()][tokenMint] = true
      }
    }

    // const dynamicEntrySize = walletBalance / 1e9 / 3 / 80
    const amountToBuyInSol = 0.005
    // dynamicEntrySize < 0.005
    //   ? 0.005
    //   : dynamicEntrySize > 0.05
    //   ? 0.05
    //   : dynamicEntrySize

    console.log(
      `${chalk.greenBright(
        "[SNIPING_BOT]"
      )} ${keypair.publicKey.toString()}: Buying ${tokenMint} | ${new Date().toUTCString()}`
    )

    if (transactionSource === "Raydium") {
      // const res = await buyRaydiumToken(
      //   sniperConnection,
      //   keypair,
      //   tokenMint,
      //   tokenPairAddress,
      //   amountToBuyInSol,
      //   tokenRaydiumPoolKeys
      // )
      // console.log(res)
    } else if (transactionSource === "Pumpfun") {
      const pumpfunTx = await getBuyPumpfunTokenTransaction(
        connection,
        keypair,
        new PublicKey(tokenMint),
        new PublicKey(tokenPairAddress),
        new PublicKey(tokenPumpfunBondingCurveAta!),
        new PublicKey(tokenPumpfunGlobalAddress!),
        amountToBuyInSol
      )

      return pumpfunTx
    }
  } catch (e) {
    console.error("Error buying token", e)
  } finally {
    if (keypair.publicKey.toString() in isWalletBuyingToken) {
      isWalletBuyingToken[keypair.publicKey.toString()][tokenMint] = false
    }
  }
}

const expressApp = express().use(express.json())

const options = {
  key: readFileSync(process.env.HTTPS_KEY_PATH as string),
  cert: readFileSync(process.env.HTTPS_CERT_PATH as string)
};
const server = createServer(options, expressApp)

const socketConnection = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
})



expressApp.post("/", async (req, res) => {
  try {
    await onTransactionBuyAndSignalToken(req.body[0])
  } catch (e: any) {
    console.log(e + "")
  } finally {
    return res.status(200).send("ok")
  }
})

const port = process.env.API_PORT || 443
server.listen(port, () => console.log(`App is running on port ${port}`))


const connection = new Connection(heliusRpcUrl, {
  confirmTransactionInitialTimeout: 1 * 80 * 1000,
  commitment: "processed",
})

const pumpfunProgram = new Program(
  idl as Idl,
  new PublicKey(PUMPFUN_PROGRAM_ID),
  new AnchorProvider(
    connection,
    new NodeWallet(Keypair.generate()),
    AnchorProvider.defaultOptions()
  )
)

const telegramBot = new Bot(process.env.TELEGRAM_BOT_TOKEN as string)
type WebhookEnhancedTransaction = typeof examplePumpfun

// Parse transaction into readable data
const getParsedTokenAndTransactionDataFromTransaction = async (
  transaction: WebhookEnhancedTransaction
) => {
  const isRaydium = !!transaction.accountData.find(
    (data) => data.account === RAYDIUM_PROGRAM_ID
  )

  const isPumpFun = !!transaction.accountData.find(
    (data) => data.account === PUMPFUN_PROGRAM_ID
  )

  const isJup = !!transaction.accountData.find(
    (data) => data.account === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
  )

  const isMoonShot = !!transaction.accountData.find(
    (data) => data.account === MOONSHOT_PROGRAM_ID
  )

  const isRaydiumCAMM = !!transaction.accountData.find(
    (data) => data.account === "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
  )

  const isMeteora = !!transaction.accountData.find(
    (data) => data.account === "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB"
  )

  if (
    !isRaydium &&
    !isPumpFun &&
    !isJup &&
    !isMoonShot &&
    !isRaydiumCAMM &&
    !isMeteora
  ) {
    console.log(
      chalk.red("Transaction is not Raydium, PumpFun, Jup or Moonshot") +
      ` https://solscan.io/tx/${transaction.signature}`
    )
    return null
  }

  const data = getTransactionDataFromWebhookTransaction(transaction)

  if (!data) return null

  const { tokenMint, isBuy, isSell, solAmount, tokenAmount, price } = data

  const transactionWallet = transaction.feePayer

  if (isSell || !isBuy) return null
  if (!tokenMint) throw new Error("No token mint found")

  let transactionSource: "Pumpfun" | "Raydium",
    tokenVault,
    tokenPairAddress,
    tokenLiquidity,
    tokenRaydiumPoolKeys,
    tokenPumpfunGlobalAddress,
    tokenPumpfunBondingCurveAta
  if (isPumpFun) {
    const pumpFunIx = getTransactionInstructionByProgramId(
      transaction,
      PUMPFUN_PROGRAM_ID
    )

    if (!pumpFunIx) {
      throw new Error(
        "Transaction is PumpFun, but no PumpFun instruction found " +
        ` https://solscan.io/tx/${transaction.signature}`
      )
    }

    transactionSource = "Pumpfun"
    tokenPairAddress = pumpFunIx.accounts[3]
    tokenPumpfunGlobalAddress = pumpFunIx.accounts[0]
    tokenPumpfunBondingCurveAta = pumpFunIx.accounts[4]
    tokenVault = tokenPairAddress
  } else if (isRaydium) {
    const raydiumIx = getTransactionInstructionByProgramId(
      transaction,
      RAYDIUM_PROGRAM_ID
    )

    if (!raydiumIx) {
      throw new Error(
        "Transaction is Raydium, but no Raydium instruction found " +
        ` https://solscan.io/tx/${transaction.signature}`
      )
    }

    transactionSource = "Raydium"
    tokenVault = RAYDIUM_AUTHORITY

    tokenPairAddress = raydiumIx.accounts[1]

    tokenRaydiumPoolKeys = (
      await fetchPoolAndMarketAccounts(connection, tokenPairAddress)
    ).poolKeys
  } else if (isMoonShot) {
    return null
    // const moonshotIx = getTransactionInstructionByProgramId(
    //   transaction,
    //   MOONSHOT_PROGRAM_ID
    // )
    // if (!moonshotIx) {
    //   throw new Error(
    //     "Transaction is Moonshot, but no Moonshot instruction found " +
    //       ` https://solscan.io/tx/${transaction.signature}`
    //   )
    // }

    // console.log(
    //   chalk.yellowBright("moonshot found") +
    //     ` https://solscan.io/tx/${transaction.signature}`
    // )
    // tokenVault = moonshotIx.accounts[3]
    // tokenPairAddress = tokenVault
    // transactionSource = "Moonshot"
    // tokenLiquidity =
    //   (await connection.getBalance(new PublicKey(tokenVault))) / 1e9
  } else {
    return null
  }
  if (!price) {
    throw new Error(
      "Token price not found " +
      ` https://solscan.io/tx/${transaction.signature}`
    )
  }
  const {
    tokenSupply,
    topFivePercentage: tokenTopFiveHoldersPercentage,
    lpPercentage: tokenLpPercentage,
    isRenounced: tokenIsRenounced,
  } = await getMintData(connection, new PublicKey(tokenMint), tokenVault)

  const tokenFdv =
    (Number(price) * Number(tokenSupply.value.amount)) /
    10 ** tokenSupply.value.decimals

  const transactionTimestamp = transaction.timestamp * 1000

  const asset = await fetchMintAsset(tokenMint)

  if (!asset) throw new Error("Digital Asset not found")

  return {
    transactionSource,
    tokenPrice: price,
    tokenVault,
    tokenPairAddress,
    tokenLiquidity,
    tokenMint,
    transactionBuyAmount: undefined,
    transactionWallet,
    tokenTopFiveHoldersPercentage,
    tokenLpPercentage,
    tokenIsRenounced,
    tokenFdv,
    transactionTimestamp,

    tokenData: asset,
    tokenRaydiumPoolKeys,
    tokenPumpfunGlobalAddress,
    tokenPumpfunBondingCurveAta,
  }
}

const getSocialsSignalMessage = async (
  tokenData: Awaited<ReturnType<typeof fetchMintAsset>>,
  transactionSource: string,
  tokenFdv: number,
  tokenPrice: number,
  tokenIsRenounced: boolean,
  tokenLpPercentage: number,
  tokenTopFiveHoldersPercentage: number,
  isSniped: boolean
) => {
  const solanaPrice = await getSolanaPrice()
  const marketCapInUsd = solanaPrice * tokenFdv
  const priceInUsd = solanaPrice * tokenPrice
  const isTopFiveGood = tokenTopFiveHoldersPercentage <= 32

  const isLpPercentageGood =
    tokenLpPercentage !== null && (tokenLpPercentage as number) >= 10

  const uniqueBuyersSqlRes = await selectTokenEntriesUniqueBuyers(
    tokenData.mint.publicKey.toString()
  )

  // Diminishing Factors: The factors array [1, 0.5, 0.25]
  // ensures that the first buyer has full impact, the second buyer contributes half of their score, the third contributes a quarter, and so on.
  const diminishingFactors = [1, 0.5] // Factors to ensure around or less than half is summed after the first buyer

  const score = Array.from(uniqueBuyersSqlRes).reduce((acc, buyer, index) => {
    // const walletScore = (walletsInfo as any)[buyer]?.score

    // if (walletScore) {
    //   // Use diminishing factors based on the index
    //   const factor = diminishingFactors[index] || 0.3
    //   const adjustedScore = walletScore * factor
    //   return acc + adjustedScore
    // }

    return acc
  }, 0)

  let sourceName, sourceLink
  switch (transactionSource) {
    case "Raydium":
      sourceName = "Raydium"
      sourceLink = `https://dexscreener.com/solana/${tokenData.mint.publicKey.toString()}`

      break
    case "Pumpfun":
      sourceName = "Pumpfun"
      sourceLink = `https://pump.fun/${tokenData.mint.publicKey.toString()}`
      break
    case "Moonshot":
      sourceName = "Moonshot"
      sourceLink = `https://dexscreener.com/solana/${tokenData.mint.publicKey.toString()}`
      break
    default:
      sourceName = "Unknown"
      sourceLink = ""
      break
  }

  return `
  ${isSniped ? "🟢" : "⚪"} $\`${tokenData.metadata.symbol}\` \\(\`${tokenData.metadata.name
    }\`\\) bought by the cabal on ${transactionSource}
  
  \`${tokenData.mint.publicKey.toString()}\`
  
  📈 Price: $\`${priceInUsd.toFixed(7)}\`
  💰 MC: \`${Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(marketCapInUsd)}\`
  ────────────
  ℹ️ Renounced: ${tokenIsRenounced ? "☑️ Yes" : "⚠️ No"}
  ℹ️ Top 5 holders: ${isTopFiveGood ? "☑️" : "⚠️"
    } ${tokenTopFiveHoldersPercentage.toFixed(0)}% \\(${isTopFiveGood ? "Good" : "High"
    }\\)
  ${
    //   `ℹ️ LP supply: ${isLpPercentageGood ? "☑️" : "⚠️"} ${
    //   tokenLpPercentage ? tokenLpPercentage?.toFixed(0) : "Low"
    // }% \\(${isLpPercentageGood ? "Good" : "low"}\\)`
    ``
    }
  🔗 [[${sourceName === "Raydium" ? "DexScreener" : sourceName
    }]](${sourceLink}) \\|  [[BonkBot]](https://t.me/bonkbot_bot?start=ref_1ncf2_ca_${tokenData.mint.publicKey.toString()}) \\|  [[Trojan]](https://t.me/paris_trojanbot?start=r-edceds-${tokenData.mint.publicKey.toString()}) \\|  [[Photon]](https://photon-sol.tinyastro.io/en/lp/${tokenData.mint.publicKey.toString()}?handle=19437044e66753b1e4627) \\|  [[Pepeboost]](https://t.me/pepeboost_sol_bot?start=ref_0261rz_ca_${tokenData.mint.publicKey.toString()}) \\|  [[BullX]](https://bullx.io/terminal?chainId=1399811149&address=${tokenData.mint.publicKey.toString()})`
}
const sendSocialsNotification = async (
  data: Exclude<
    Awaited<ReturnType<typeof getParsedTokenAndTransactionDataFromTransaction>>,
    null
  >,
  isSniped: boolean,
  discordChannel: string,
  telegramThreadId?: number
) => {
  const msg = await getSocialsSignalMessage(
    data.tokenData,
    data.transactionSource,
    data.tokenFdv,
    data.tokenPrice,
    data.tokenIsRenounced,
    data.tokenLpPercentage,
    data.tokenTopFiveHoldersPercentage,
    isSniped
  )

  try {
    // Send to Telegram
    await telegramBot.api.sendMessage("-1002246150675", msg, {
      parse_mode: "MarkdownV2",
      message_thread_id: telegramThreadId,
    })
  } catch (e) {
    console.error("Couldn't send Telegram message " + e)
  }

  try {
    await sendDiscordMessage(msg, discordChannel, data.tokenData)
  } catch (e) {
    console.error("Couldn't send Discord message" + e)
  }
}

const sendDiscordMessage = async (
  msg: string,
  channelId: string,
  tokenData: Awaited<ReturnType<typeof fetchMintAsset>>
) => {
  const color = stringToColour(tokenData.mint.publicKey.toString())

  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      body: JSON.stringify({
        embeds: [
          {
            title: ``,
            description: msg,
            color: parseInt(color, 16),
            // thumbnail: {
            //   url: tokenData.metadata.offchain.image,
            //   width: 64,
            //   height: 64,
            // },
          },
        ],
      }),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      },
    }
  )

  if (!res.ok) {
    throw new Error("Invalid request")
  }
}

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN

const stringToColour = (str: string) => {
  let hash = 0
  str.split("").forEach((char) => {
    hash = char.charCodeAt(0) + ((hash << 5) - hash)
  })
  let colour = ""
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff
    colour += value.toString(16).padStart(2, "0")
  }
  return colour
}

// @ts-ignore
BigInt.prototype["toJSON"] = function () {
  return parseInt(this.toString())
}
