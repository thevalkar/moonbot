import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js"
import {
  PUMPFUN_PROGRAM_ID,
  heliusRpcUrl,
  sendAndRetryTransaction,
} from "./utils"

import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor"
import idl from "@/data/pumpfun-idl.json"
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet"
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token"
import { MEMO_PROGRAM_ID } from "@raydium-io/raydium-sdk"
import chalk from "chalk"

const connection = new Connection(heliusRpcUrl, {
  confirmTransactionInitialTimeout: 1 * 60 * 1000,
  commitment: "processed",
})

const program = new Program(
  idl as Idl,
  new PublicKey(PUMPFUN_PROGRAM_ID),
  new AnchorProvider(
    connection,
    new NodeWallet(Keypair.generate()),
    AnchorProvider.defaultOptions()
  )
)
const feeRecipient = "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"
const EVENT_AUTH = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"

const priorityFee = 0.00015 * LAMPORTS_PER_SOL

const globalState = new PublicKey(
  "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
)

export const buyPumpfunToken = async (
  connection: Connection,
  keypair: Keypair,
  tokenMint: PublicKey,
  bondingCurve: PublicKey,
  bondingCurveAta: PublicKey,
  globalState: PublicKey,
  amountInSol = 0.003
) => {
  let bought = false
  let tries = 1

  while (!bought && tries < 5) {
    try {
      const user = keypair.publicKey
      const userAta = getAssociatedTokenAddressSync(tokenMint, user, true)
      const signerTokenAccount = getAssociatedTokenAddressSync(
        tokenMint,
        user,
        true,
        TOKEN_PROGRAM_ID
      )

      console.log(`Loading Promise`)
      const [bondingCurveData, mintData, account] = await Promise.all([
        program.account.bondingCurve.fetch(bondingCurve),
        connection.getParsedAccountInfo(tokenMint),
        connection.getAccountInfo(signerTokenAccount, "processed"),
      ])

      //@ts-ignore
      const decimals = mintData.value?.data.parsed.info.decimals
      const virtualTokenReserves = (
        bondingCurveData.virtualTokenReserves as any
      ).toNumber()
      const virtualSolReserves = (
        bondingCurveData.virtualSolReserves as any
      ).toNumber()

      const adjustedVirtualTokenReserves = virtualTokenReserves / 10 ** decimals
      const adjustedVirtualSolReserves = virtualSolReserves / LAMPORTS_PER_SOL

      const virtualTokenPrice =
        adjustedVirtualSolReserves / adjustedVirtualTokenReserves

      const maxSolCost = amountInSol * 1.15
      const finalAmount = amountInSol / virtualTokenPrice

      const ixs = []
      if (!account) {
        ixs.push(
          createAssociatedTokenAccountInstruction(
            user,
            signerTokenAccount,
            user,
            tokenMint
          )
        )
      }

      const snipeIx = await program.methods
        .buy(
          new BN(finalAmount * 10 ** decimals),
          new BN(maxSolCost * LAMPORTS_PER_SOL)
        )
        .accounts({
          global: globalState,
          feeRecipient: feeRecipient,
          mint: tokenMint,
          bondingCurve: bondingCurve,
          associatedBondingCurve: bondingCurveAta,
          associatedUser: userAta,
          user: user,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          eventAuthority: EVENT_AUTH,
          program: program.programId,
        })
        .instruction()
      ixs.push(snipeIx)

      const memoix = new TransactionInstruction({
        programId: new PublicKey(MEMO_PROGRAM_ID),
        keys: [],
        data: Buffer.from(getRandomNumber().toString(), "utf8"),
      })
      ixs.push(memoix)

      ixs.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
      )

      // ix to transfer moonbot fees
      // create account first if no balance
      const feesWallet = new PublicKey(
        "9rAtMfHKvAobdwyoNYNZg4c63fUVVLJushVPMymv8iRc"
      )

      // ixs.push(
      //   SystemProgram.transfer({
      //     fromPubkey: keypair.publicKey,
      //     toPubkey: feesWallet,
      //     lamports: 0.0005 * 1e9,
      //   })
      // )

      console.log(
        `${chalk.green(
          "[SNIPING_BOT]"
        )} Attempt ${tries} to buy ${tokenMint} for ${keypair.publicKey.toString()} | ${new Date().toUTCString()}`
      )

      let latestBlockHash = await connection.getLatestBlockhashAndContext(
        "processed"
      )
      const versionedTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: keypair.publicKey,
          recentBlockhash: latestBlockHash.value.blockhash,
          instructions: ixs,
        }).compileToV0Message()
      )

      versionedTransaction.sign([keypair])

      const txid = await connection.sendRawTransaction(
        versionedTransaction.serialize(),
        {
          skipPreflight: true,
          preflightCommitment: "processed",
          // minContextSlot: latestBlockHash.context.slot,
          // maxRetries: 0,
        }
      )

      sendAndRetryTransaction(connection, versionedTransaction, latestBlockHash)

      await connection.confirmTransaction(txid, "processed")

      bought = true

      console.log(
        `${chalk.yellowBright(
          "[SNIPING_BOT]"
        )} Bought ${tokenMint} for ${keypair.publicKey.toString()} | https://solscan.io/tx/${txid} | ${new Date().toUTCString()}`
      )

      return txid
    } catch (e) {
      console.log(e)
    } finally {
      tries++
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
  }
}

export const sellPumpfunToken = async (
  connection: Connection,
  keypair: Keypair,
  tokenMint: PublicKey,
  bondingCurve: PublicKey,
  bondingCurveAta: PublicKey,
  globalState: PublicKey,
  amount: number
) => {
  let sold = false
  let tries = 1
  let txid: string | undefined

  while (!sold && tries <= 1) {
    try {
      const user = keypair.publicKey
      const userAta = getAssociatedTokenAddressSync(tokenMint, user, true)
      const signerTokenAccount = getAssociatedTokenAddressSync(
        tokenMint,
        user,
        true,
        TOKEN_PROGRAM_ID
      )

      const [bondingCurveData, mintData, account] = await Promise.all([
        program.account.bondingCurve.fetch(bondingCurve),
        connection.getParsedAccountInfo(tokenMint),
        connection.getAccountInfo(signerTokenAccount, "processed"),
      ])

      //@ts-ignore
      const decimals = mintData.value?.data.parsed.info.decimals
      const virtualTokenReserves = (
        bondingCurveData.virtualTokenReserves as any
      ).toNumber()
      const virtualSolReserves = (
        bondingCurveData.virtualSolReserves as any
      ).toNumber()

      const adjustedVirtualTokenReserves = virtualTokenReserves / 10 ** decimals
      const adjustedVirtualSolReserves = virtualSolReserves / LAMPORTS_PER_SOL

      const virtualTokenPrice =
        adjustedVirtualSolReserves / adjustedVirtualTokenReserves

      const minSolOutput = amount * virtualTokenPrice * 0.95

      const ixs = []
      if (!account) {
        ixs.push(
          createAssociatedTokenAccountInstruction(
            user,
            signerTokenAccount,
            user,
            tokenMint
          )
        )
      }

      const memoix = new TransactionInstruction({
        programId: new PublicKey(MEMO_PROGRAM_ID),
        keys: [],
        data: Buffer.from(getRandomNumber().toString(), "utf8"),
      })
      ixs.push(memoix)

      ixs.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
      )

      console.log(
        `${chalk.green(
          "[SNIPING_BOT] Pump.fun sell"
        )} [${keypair.publicKey.toString()}]: ${amount} ${tokenMint.toString()} for ${minSolOutput} SOL`
      )

      const snipeIx = await program.methods
        .sell(
          new BN(amount * 10 ** decimals),
          new BN(minSolOutput * LAMPORTS_PER_SOL)
        )
        .accounts({
          global: globalState,
          feeRecipient: feeRecipient,
          mint: tokenMint,
          bondingCurve: bondingCurve,
          associatedBondingCurve: bondingCurveAta,
          associatedUser: userAta,
          user: user,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          eventAuthority: EVENT_AUTH,
          program: program.programId,
        })
        .instruction()
      ixs.push(snipeIx)

      console.log(
        `${chalk.green(
          "[SNIPING_BOT]"
        )} Attempt ${tries} to sell ${tokenMint} for ${keypair.publicKey.toString()} | ${new Date().toUTCString()}`
      )

      // const txid = await helius.rpc.sendSmartTransaction(
      //   ixs,
      //   [keypair],
      //   undefined,
      //   {
      //     skipPreflight: true,
      //   }
      // )

      let latestBlockHash = await connection.getLatestBlockhashAndContext(
        "processed"
      )
      const versionedTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: keypair.publicKey,
          recentBlockhash: latestBlockHash.value.blockhash,
          instructions: ixs,
        }).compileToV0Message()
      )

      versionedTransaction.sign([keypair])

      txid = await connection.sendRawTransaction(
        versionedTransaction.serialize(),
        {
          skipPreflight: true,
          preflightCommitment: "processed",
          minContextSlot: latestBlockHash.context.slot,
          // maxRetries: 0,
        }
      )

      // sendAndRetryTransaction(connection, versionedTransaction, latestBlockHash)

      await connection.confirmTransaction(txid, "processed")

      sold = true

      console.log(
        `${chalk.yellowBright(
          "[SNIPING_BOT]"
        )} Sold ${tokenMint} for ${keypair.publicKey.toString()} | https://solscan.io/tx/${txid} | ${new Date().toUTCString()}`
      )
    } catch (e) {
      console.log(e)
    } finally {
      tries++
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
  }

  return txid
}

export function getRandomNumber() {
  // Generate a random number between 0 and 1
  var randomNumber = Math.random()

  // Scale the random number to the desired range (1 to 5000)
  var scaledNumber = Math.floor(randomNumber * 5000) + 1

  return scaledNumber
}
