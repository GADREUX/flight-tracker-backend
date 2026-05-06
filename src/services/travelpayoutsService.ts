/**
 * Travelpayouts Service (Aviasales)
 *
 * API de afiliados — gratuita, sem limite de chamadas.
 * Dados cacheados com atualização a cada 12-24h (adequado para alertas).
 *
 * Cadastro: https://www.travelpayouts.com/en/registration
 * Token:    https://www.travelpayouts.com/en/developers/api (aba "API")
 * Docs:     https://support.travelpayouts.com/hc/en-us/articles/203956163
 *
 * Dois endpoints úteis:
 *   1. /v1/prices/cheap      → preços mais baratos por mês (cache)
 *   2. /v2/prices/latest     → últimas pesquisas reais de usuários
 *
 * Para alertas de preço, usamos /v2/prices/latest que tem dados
 * mais recentes (últimas pesquisas de outros usuários na plataforma).
 *
 * Para usar: trocar import no priceEngine.ts:
 *   import { fetchFlightPrice } from "./travelpayoutsService"
 */

import { buildDeepLink } from "./deepLinkBuilder"
import type { CabinClass } from "@prisma/client"
import type { FetchPriceParams, PriceFetchResult } from "./duffelService"

export type { FetchPriceParams, PriceFetchResult }

const BASE_URL = "https://api.travelpayouts.com"
const MAX_RETRY = 3

// Travelpayouts usa código de 2 letras para cabine em alguns endpoints
const CABIN: Record<CabinClass, "Y" | "C" | "F"> = {
  ECONOMY:  "Y",
  BUSINESS: "C",
  FIRST:    "F",
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function fetchFlightPrice(
  params: FetchPriceParams,
  attempt = 1
): Promise<PriceFetchResult | null> {
  // Tenta primeiro o endpoint de preços mais recentes (dados mais frescos)
  const result = await fetchLatestPrice(params, attempt)
  if (result) return result

  // Fallback: preços baratos por mês (cache, mas sempre tem dados)
  return fetchCheapPrice(params)
}

// ─── Endpoint 1: últimas pesquisas (dados mais frescos) ───────────────────────

async function fetchLatestPrice(
  params: FetchPriceParams,
  attempt: number
): Promise<PriceFetchResult | null> {
  const qs = new URLSearchParams({
    origin:      params.origin,
    destination: params.destination,
    currency:    params.currency,
    token:       process.env.TRAVELPAYOUTS_TOKEN!,
    limit:       "10",
    sorting:     "price",
    one_way:     params.returnDate ? "false" : "true",
  })

  const res = await fetch(`${BASE_URL}/v2/prices/latest?${qs}`)

  if (res.status === 429) {
    if (attempt >= MAX_RETRY) return null
    await sleep(2000)
    return fetchLatestPrice({ ...params }, attempt + 1)
  }

  if (!res.ok) return null

  const body: LatestPricesResponse = await res.json()
  if (!body.success || !body.data?.length) return null

  // Filtra pela data de partida pedida (dentro de ±3 dias de tolerância)
  const targetDate = toDate(params.departureDate)
  const matching = body.data
    .filter((d) => dateDiffDays(d.depart_date, targetDate) <= 3)
    .sort((a, b) => a.value - b.value)

  const best = matching[0] ?? body.data.sort((a, b) => a.value - b.value)[0]

  return {
    price:    best.value,
    currency: params.currency,
    airline:  best.airline,
    deepLink: buildDeepLink({
      airline:       best.airline,
      origin:        params.origin,
      destination:   params.destination,
      departureDate: params.departureDate,
      returnDate:    params.returnDate,
      adults:        params.adults,
      cabinClass:    params.cabinClass,
    }),
  }
}

// ─── Endpoint 2: preços baratos por mês (fallback) ───────────────────────────

async function fetchCheapPrice(
  params: FetchPriceParams
): Promise<PriceFetchResult | null> {
  const departDate = toDate(params.departureDate)
  const [year, month] = departDate.split("-")

  const qs = new URLSearchParams({
    origin:      params.origin,
    destination: params.destination,
    depart_date: `${year}-${month}`,
    currency:    params.currency,
    token:       process.env.TRAVELPAYOUTS_TOKEN!,
    one_way:     params.returnDate ? "false" : "true",
  })

  const res = await fetch(`${BASE_URL}/v1/prices/cheap?${qs}`)
  if (!res.ok) return null

  const body: CheapPricesResponse = await res.json()
  if (!body.success) return null

  // body.data é um objeto keyed por airline IATA
  const entries = Object.entries(body.data ?? {})
  if (!entries.length) return null

  // Pega o mais barato
  const best = entries.sort(([, a], [, b]) => a.price - b.price)[0]
  const [airline, info] = best

  return {
    price:    info.price,
    currency: params.currency,
    airline,
    deepLink: buildDeepLink({
      airline,
      origin:        params.origin,
      destination:   params.destination,
      departureDate: params.departureDate,
      returnDate:    params.returnDate,
      adults:        params.adults,
      cabinClass:    params.cabinClass,
    }),
  }
}

// ─── Response types ───────────────────────────────────────────────────────────

interface LatestPriceEntry {
  airline:     string    // IATA code: "LA", "G3"…
  value:       number    // preço
  depart_date: string    // "YYYY-MM-DD"
  return_date: string
  number_of_changes: number
}

interface LatestPricesResponse {
  success: boolean
  data:    LatestPriceEntry[]
}

interface CheapPriceEntry {
  price:       number
  transfers:   number
  return_date: string
  depart_date: string
}

interface CheapPricesResponse {
  success: boolean
  data:    Record<string, CheapPriceEntry>   // keyed by airline IATA
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function toDate(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

function dateDiffDays(a: string, b: string): number {
  const msPerDay = 86_400_000
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / msPerDay
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
