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
export async function sendJitoBundle(transactions: Uint8Array[], jitoTipAmountInSol = 0.0011) {
  const base58EncodedTransactions = transactions.map((tx) => bs58.encode(tx))
  const jitoClient = new JitoJsonRpcClient(
    "https://mainnet.block-engine.jito.wtf/api/v1",
    ""
  )

  const randomTipAccount = "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49"
  const jitoTipAccount = new PublicKey(randomTipAccount)
  const jitoTipAmount = jitoTipAmountInSol * LAMPORTS_PER_SOL

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

  batches.map(async batch => {

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
        [base58EncodedJitoTransaction].concat(batch),
      ])

      const bundleId = res.result
      console.log("Bundle ID:", bundleId)
      const inflightStatus = await jitoClient.confirmInflightBundle(
        bundleId,
        15000
      )

      if (inflightStatus.status === "Landed") {
        console.log(
          `Batch successfully confirmed on-chain at slot ${inflightStatus.slot}`
        )

        return bundleId
      } else {
        console.log(inflightStatus)

        throw new Error(
          "Batch processing failed: " +
          JSON.stringify(inflightStatus) +
          ""
        )
      }

    } catch (e: any) {
      console.error("Error sending batch:", e)
      if (e.response && e.response.data) {
        console.error("Server response:", e.response.data)
      }

    }
  })

  console.log("All batches confirmed successfully.")
}
