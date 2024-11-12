import { Keypair } from "@solana/web3.js"
import postgres from "postgres"
import { DigitalAsset } from "@metaplex-foundation/mpl-token-metadata"
import dotenv from "dotenv"

dotenv.config({
  path: '/root/workspace/moonbot/.env'
})

export const sql = postgres(process.env.DATABASE_URL as string)

export type PairSqlRow = {
  token_mint: string
  address: string
  source: string
  data: {
    creationDateUtc: string
    creationDateTimestamp: number
    associatedBondingCurve?: string
    initialPrice: number
  }
}

export type TokenSqlRow = {
  mint: string
  data: DigitalAsset & {
    metadata: {
      name: string
      offchain: any
    }
  }
  pair_address: string
}

export type UserConfig = {
  entry: number
  strategy: "automatic" | "default"
  discordid: string
  min_times_bought: number
}

export type Signal = {
  token_mint: string
  price: number
  timestamp: number
  source: string
  buyers: number
  pair_address: string
  amount: number
}

export type SignalWithEntry = {
  token_mint: string
  signal_price: number
  signal_timestamp: number
  signal_source: string
  buyers: number
  amount: number
  entry_price: number
  entry_buyer: string
  entry_source: string
}


export const getSignals = async (maxHoursOld = 24) => {
  console.time("signals query")
  const signalsWithEntry = await sql<SignalWithEntry[]>`
  WITH RankedSignals AS (
    SELECT 
      ts.token_mint, 
      ts.price AS signal_price, 
      ts.timestamp AS signal_timestamp, 
      ts.source AS signal_source, 
      ts.buyers, 
      ts.amount, 
      te.price AS entry_price, 
      te.buyer AS entry_buyer, 
      te.source AS entry_source,
      ROW_NUMBER() OVER (PARTITION BY ts.token_mint ORDER BY ts.timestamp DESC) AS rn
    FROM 
      token_signals ts
    LEFT JOIN 
      token_entries te 
    ON 
      ts.token_mint = te.token_mint 
    AND 
      ts.timestamp = te.timestamp
    AND 
      ts.price = te.price
    WHERE ts.timestamp > ${Date.now() - maxHoursOld * 60 * 60 * 1000}
  )
  SELECT 
    token_mint, 
    signal_price, 
    signal_timestamp, 
    signal_source, 
    buyers, 
    amount, 
    entry_price, 
    entry_buyer, 
    entry_source
  FROM 
    RankedSignals
  WHERE 
    rn = 1
  ORDER BY 
    signal_timestamp DESC;
`

  const tokensToFetch = new Set<string>()
  signalsWithEntry.forEach((signal) => {
    tokensToFetch.add(signal.token_mint)
  })

  console.timeEnd("signals query")

  const tokens = await getTokens(Array.from(tokensToFetch))
  const tokensMap = tokens.reduce<{
    [tokenMint: string]: TokenSqlRow
  }>((acc, row) => {
    acc[row.mint] = row
    return acc
  }, {})

  const signalsWithToken = signalsWithEntry.map((signal) => {
    const token = tokensMap[signal.token_mint]

    return {
      ...signal,
      token,
    }
  })

  return signalsWithToken
}

export const getTokens = async (mints?: string[]) => {
  const tokens: TokenSqlRow[] = mints
    ? await sql`SELECT mint, data, pair_address FROM tokens WHERE mint in ${sql(
      mints
    )}`
    : await sql`SELECT mint, data, pair_address FROM tokens`

  return tokens
}

export type PriceSqlRow = {
  price: number
  timestamp: string
  token_mint: string
}

export const getTokenSignals = async (mint: string) => {
  const res = await sql`
    SELECT token_mint, buyers from token_signals where token_mint=${mint}
  `

  return res
}
export const insertTokenSignal = async (
  mint: string,
  price: number,
  pair: string,
  timestamp: number,
  source: string,
  buyers: number,
  buyer: string,
  amount?: number
) => {
  const res = await sql<Signal[]>`
    INSERT INTO token_signals (token_mint, price, pair_address, timestamp, source, buyers, buyer, amount)
    VALUES (${mint}, ${price}, ${pair}, ${timestamp}, ${source}, ${buyers}, ${buyer}, ${amount || null
    })
  RETURNING *
  `
  return res
}

export const selectTokenEntriesUniqueBuyers = async (token_mint: string) => {
  const res = await sql<
    { unique_buyers: string[] }[]
  >`select array_agg(distinct buyer) as unique_buyers from token_entries where token_mint=${token_mint};`

  return res[0]?.unique_buyers
}

export const insertTokenEntry = async (
  mint: string,
  buyer: string,
  price: number,
  timestamp: number,
  source: string,
  amount?: number,
  tokenInsights?: {
    lpPercentage: number
    isRenounced: boolean
    fdv: number
  }
) => {
  const res =
    await sql`INSERT INTO token_entries (token_mint, buyer, price, amount, timestamp, source, token_insights) VALUES(${mint}, ${buyer}, ${price},${amount || null
      }, ${timestamp},${source},${tokenInsights as never})
    RETURNING *`

  return res[0]
}

export const insertTokenPrice = async (
  mint: string,
  price: number,
  pairAddress: string
) => {
  const res =
    await sql`INSERT INTO token_price (token_mint, price, pair_address) VALUES(${mint}, ${price}, ${pairAddress})
    ON CONFLICT (pair_address) DO UPDATE SET price = ${price}
  RETURNING *`

  return res
}

export const insertToken = async (
  mint: string,
  data: DigitalAsset | null = null,
  pairAddress: string,
  pairSource: "Raydium" | "Pumpfun",
  tokenPumpfunBondingCurveAta: string | null = null
) => {
  const res = await sql<
    TokenSqlRow[]
  >`INSERT INTO tokens (mint, data, pair_address, pair_source, pumpfun_bonding_curve_ata) VALUES(${mint}, ${data as never
  }, ${pairAddress}, ${pairSource}, ${tokenPumpfunBondingCurveAta})
    ON CONFLICT (mint) DO UPDATE SET pair_address = ${pairAddress}, pair_source = ${pairSource}, ${data ? sql`data = ${data as never},` : sql``
    } pumpfun_bonding_curve_ata = ${tokenPumpfunBondingCurveAta}
  RETURNING *`

  return res[0]
}

export const insertPair = async (
  address: string,
  source: "RAYDIUM" | "PUMPFUN",
  tokenMint: string,
  data: unknown = null
) => {
  const res = sql`INSERT INTO pairs (address, source, token_mint, data) VALUES(${address}, ${source}, ${tokenMint}, ${data as never
    })

  RETURNING *`

  return res
}

export const insertPoolAddress = async (token: string, poolAddress: string) => {
  const res = await sql`
            INSERT INTO pool_addresses (token, pool_address)
            VALUES (${token}, ${poolAddress})
        `

  return res[0]
}

export default sql
