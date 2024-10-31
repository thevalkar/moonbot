import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js"
// @ts-ignore
import { JitoJsonRpcClient } from "jito-js-rpc"
import bs58 from "bs58"
import { heliusRpcUrl } from "./utils"

const connection = new Connection(heliusRpcUrl)

const payerKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(process.env.JITO_PAYER_KEYPAIR as string))
)
export async function sendJitoBundle(transactions: Uint8Array[]) {
  const base58EncodedTransactions = transactions.map((tx) => bs58.encode(tx))
  const jitoClient = new JitoJsonRpcClient(
    "https://mainnet.block-engine.jito.wtf/api/v1",
    ""
  )

  const randomTipAccount = await jitoClient.getRandomTipAccount()
  const jitoTipAccount = new PublicKey(randomTipAccount)
  const jitoTipAmount = 0.0011 * LAMPORTS_PER_SOL

  const memoProgramId = new PublicKey(
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
  )

  const { blockhash } = await connection.getLatestBlockhash()

  // Split transactions into batches
  const batchSize = 4
  const batches = []
  for (let i = 0; i < base58EncodedTransactions.length; i += batchSize) {
    const batch = base58EncodedTransactions.slice(i, i + batchSize)
    batches.push(batch)
  }

  const maxRetries = 3
  let retryCount = 0
  let pendingBatches = [...batches]

  while (pendingBatches.length > 0 && retryCount < maxRetries) {
    const currentBatch = pendingBatches.shift()

    if (!currentBatch) continue

    const jitoTransaction = new Transaction()
    jitoTransaction.add(
      SystemProgram.transfer({
        fromPubkey: payerKeypair.publicKey,
        toPubkey: jitoTipAccount,
        lamports: jitoTipAmount,
      })
    )

    const memoInstruction = new TransactionInstruction({
      keys: [],
      programId: memoProgramId,
      data: Buffer.from(Keypair.generate().publicKey.toString()),
    })
    jitoTransaction.add(memoInstruction)

    jitoTransaction.recentBlockhash = blockhash
    jitoTransaction.feePayer = payerKeypair.publicKey
    jitoTransaction.sign(payerKeypair)

    const serializedJitoTransaction = jitoTransaction.serialize({
      verifySignatures: false,
    })

    const base58EncodedJitoTransaction = bs58.encode(serializedJitoTransaction)

    try {
      const res = await jitoClient.sendBundle([
        [base58EncodedJitoTransaction].concat(currentBatch),
      ])

      const bundleId = res.result
      console.log("Bundle ID:", bundleId)
      ;(async () => {
        try {
          const inflightStatus = await jitoClient.confirmInflightBundle(
            bundleId,
            120000
          )
          console.log(
            "Inflight bundle status:",
            JSON.stringify(inflightStatus, null, 2)
          )

          if (inflightStatus.confirmation_status === "confirmed") {
            console.log(
              `Batch successfully confirmed on-chain at slot ${inflightStatus.slot}`
            )
          } else {
            throw new Error("Batch not confirmed. Retrying...")
          }

          if (
            inflightStatus.confirmation_status !== "confirmed" &&
            inflightStatus.err
          ) {
            throw new Error(
              "Batch processing failed: " +
                JSON.stringify(inflightStatus.err) +
                ""
            )
          }
        } catch (e: any) {
          console.error("Error confirming batch:", e)
          pendingBatches.push(currentBatch)
        }
      })()
    } catch (e: any) {
      console.error("Error sending batch:", e)
      if (e.response && e.response.data) {
        console.error("Server response:", e.response.data)
      }
      // Re-add the batch to pending for retry
      pendingBatches.push(currentBatch)

      retryCount += 1
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  if (pendingBatches.length > 0) {
    console.error(
      `Failed to confirm ${pendingBatches.length} batch(es) after ${maxRetries} retries.`
    )
    throw new Error(
      `Failed to confirm ${pendingBatches.length} batch(es) after ${maxRetries} retries.`
    )
  }

  console.log("All batches confirmed successfully.")
}
