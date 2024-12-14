import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js"
import { getCoinsPairs } from "./postgres"
import { getBuyRaydiumTokenTransaction } from "./raydium"
// import kp from "../../payer.json"
import { sendJitoBundle } from "./jito"
import { getWalletTokenBalance, sendAndRetryTransaction } from "./utils"
import { configDotenv } from "dotenv"
import chalk from "chalk"
import { getBuyPumpfunTokenTransaction } from "./pumpfun"
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token"
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@raydium-io/raydium-sdk"
import { readFileSync } from "fs"
configDotenv()

// const mainKeypair = Keypair.fromSecretKey(Uint8Array.from(kp))

const quicknodeConnection = new Connection(
  process.env.RPC_URL as string,
  "processed"
)

const heliusConnection = new Connection(
  process.env.HELIUS_RPC_URL as string,
  "processed"
)

export const snipeAnyCoinGuaranteed = async (
  coin: string,
  keypairs: Keypair[],
  attempt: number = 0
) => {
  try {
    // We only want wallets that don't have the coin yet.
    const snipers = (
      await Promise.all(
        keypairs.map(async (keypair) => {
          // Check if bought
          const walletCoinBalance = await getWalletTokenBalance(
            quicknodeConnection,
            keypair.publicKey,
            new PublicKey(coin)
          )

          if (walletCoinBalance?.value.uiAmount) {
            return false
          }

          const walletBalance = await quicknodeConnection.getBalance(
            keypair.publicKey
          )

          if (walletBalance / 1e9 < 0.05) {
            return false
          }

          return keypair
        })
      )
    ).filter((sniper) => sniper instanceof Keypair)

    if (keypairs.length > 0 && snipers.length === 0) {
      console.log(
        `${chalk.green("Success")} All snipers have already bought ${coin}`
      )
      return true
    }

    console.log(`Sniping ${coin} with ${snipers.length} wallets`)
    const pairByMint = await getCoinsPairs([coin])

    const result = pairByMint[coin]

    if (!result) {
      throw new Error(`Couldn't find pair address for ${coin}`)
    }

    const { mint, pair, source } = result

    const txByWallet: Record<string, Uint8Array> = {}
    const txs = await Promise.all(
      snipers.map(async (keypair) => {
        try {
          let tx

          if (source === "Raydium") {
            tx = await getBuyRaydiumTokenTransaction(
              quicknodeConnection,
              keypair,
              mint,
              pair,
              0.03,
              0.000269858
            )
          } else {
            tx = await getBuyPumpfunTokenTransaction(
              quicknodeConnection,
              keypair,
              new PublicKey(coin),
              new PublicKey(pair),
              0.03,
              0.000269858
            )
          }

          if (!tx || !(tx instanceof Uint8Array)) {
            // Retry mounting tx again
            snipeAnyCoinGuaranteed(coin, [keypair], attempt + 1)
            return false
          }

          txByWallet[keypair.publicKey.toString()] = tx

          return tx
        } catch (e) {
          console.log(e)
          return false
        }
      })
    )

    const buyTxs = txs.filter(
      (tx): tx is Uint8Array => !!tx && tx instanceof Uint8Array
    )

    if (!Object.values(txByWallet).length) {
      console.log("No transactions to send")
      return true
    }

    console.log(`Sending ${Object.values(txByWallet).length} transactions...`)

    try {
      // Since we can't retry sending a Jito bundle, just send it.
      sendJitoBundle(buyTxs)
    } catch (e) {
      console.log(e)
    }

    const bought: Record<string, boolean> = {}
    await Promise.all(
      snipers.map(async (keypair) => {
        if (!txByWallet[keypair.publicKey.toString()]) return null

        const blockhashAndContext =
          await heliusConnection.getLatestBlockhashAndContext("processed")

        let tries = 0,
          isBlockheightValid = true

        // Max time to send tx before mounting a new one
        const timeout = Date.now() + 1000 * 10 // Timeout of 10s

        // Try forever until bought never give up
        while (
          !bought[keypair.publicKey.toString()] &&
          isBlockheightValid &&
          Date.now() < timeout
        ) {
          try {
            // Check if bought
            const walletCoinBalance = await getWalletTokenBalance(
              quicknodeConnection,
              keypair.publicKey,
              new PublicKey(coin)
            )

            if (walletCoinBalance?.value.uiAmount) {
              console.log(
                `${chalk.green(
                  "Success"
                )} Bought ${coin} for ${keypair.publicKey.toString()} | ${new Date().toUTCString()}`
              )

              bought[keypair.publicKey.toString()] = true
              break
            }

            // Send to Jito, Helius, Quicknode, Alchemy, Triton, Your mom, Anything we possibly can
            await quicknodeConnection.sendRawTransaction(
              txByWallet[keypair.publicKey.toString()],
              {
                preflightCommitment: "processed",
                // minContextSlot: blockhashAndContext.context.slot,
                maxRetries: 0,
                // skipPreflight: true,
              }
            )
            await heliusConnection.sendRawTransaction(
              txByWallet[keypair.publicKey.toString()],
              {
                preflightCommitment: "processed",
                // minContextSlot: blockhashAndContext.context.slot,
                maxRetries: 0,
                // skipPreflight: true,
              }
            )
          } catch (e) {
            console.log(e)
          } finally {
            await new Promise((resolve) => setTimeout(resolve, 1200))

            const blockHeight = await heliusConnection.getBlockHeight(
              "processed"
            )
            isBlockheightValid =
              blockHeight <= blockhashAndContext.value.lastValidBlockHeight

            // Too much time passed. Start again
            if (
              !bought[keypair.publicKey.toString()] &&
              (!isBlockheightValid || Date.now() > timeout)
            ) {
              console.log(
                `${chalk.yellow(
                  `Too much time passed. Start again to buy ${coin} for ${keypair.publicKey.toString()}`
                )}`
              )
              break
            }

            tries++
          }
        }

        if (!bought[keypair.publicKey.toString()]) {
          if (attempt < 5) {
            snipeAnyCoinGuaranteed(coin, [keypair], attempt + 1)
          } else {
            console.log(
              `${chalk.red(
                `Failed to buy ${coin} for ${keypair.publicKey.toString()} after 5 attempts`
              )}`
            )
          }
        }

        return true
      })
    )
  } catch (e) {
    console.error(e)
  }
}

// Test mode only
// ; (async () => {
//   const keypairs = []
//   for (let i = 1; i <= 20; i++) {
//     const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('./wallets/' + i + ".json", 'utf-8'))))

//     keypairs.push(keypair)

//     // const balance = await heliusConnection.getBalance(keypair.publicKey)
//     // const balanceInSol = balance / 1e9
//     // console.log(balanceInSol)
//     // if (balanceInSol >= 0.01) {
//     //   keypairs.push(keypair)
//     // } else {
//     //   let latestBlockHash = await heliusConnection.getLatestBlockhashAndContext(
//     //     "processed"
//     //   )
//     //   console.log('from ', mainKeypair.publicKey.toString(), 'to ', keypair.publicKey.toString())
//     //   const tx = new VersionedTransaction(
//     //     new TransactionMessage({
//     //       payerKey: mainKeypair.publicKey,
//     //       recentBlockhash: latestBlockHash.value.blockhash,
//     //       instructions: [SystemProgram.transfer({
//     //         fromPubkey: mainKeypair.publicKey,
//     //         toPubkey: keypair.publicKey,
//     //         lamports: ((0.01 * 1e9) - (balanceInSol * 1e9)),
//     //       })],
//     //     }).compileToV0Message()
//     //   )

//     //   tx.sign([mainKeypair])
//     //   keypairs.push(keypair)
//     //   const { txid } = await sendAndRetryTransaction(heliusConnection, tx.serialize())
//     //   console.log(txid)
//     // }
//   }

//   snipeAnyCoinGuaranteed(coin, keypairs)

// })()
