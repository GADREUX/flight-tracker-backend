/**
 * Kiwi Tequila Service — alternativa ao Duffel
 *
 * Cadastro em: tequila.kiwi.com
 * Auth: API key no header "apikey: {key}"
 * Diferencial: retorna BRL mesmo para rotas internacionais,
 *              cobre mais combinações de rotas com conexão.
 *
 * Docs: https://tequila.kiwi.com/portal/docs/tequila-api/search_api
 *
 * Para usar: trocar import no priceEngine.ts para "./kiwiService"
 */

import { buildDeepLink } from "./deepLinkBuilder"
import type { CabinClass } from "@prisma/client"
export type { FetchPriceParams, PriceFetchResult } from "./duffelService"
import type { FetchPriceParams, PriceFetchResult } from "./duffelService"

const BASE_URL = "https://api.tequila.kiwi.com"
const MAX_RETRIES = 3

const CABIN: Record<CabinClass, string> = {
  ECONOMY:  "M",   // M = economy, W = premium economy
  BUSINESS: "C",   // C = business
  FIRST:    "F",   // F = first
}

export async function fetchFlightPrice(
  params: FetchPriceParams,
  attempt = 1
): Promise<PriceFetchResult | null> {
  const qs = new URLSearchParams({
    fly_from:    params.origin,
    fly_to:      params.destination,
    date_from:   toKiwiDate(params.departureDate),
    date_to:     toKiwiDate(params.departureDate),  // mesmo dia = busca exata
    adults:      String(params.adults),
    selected_cabins: CABIN[params.cabinClass],
    curr:        params.currency,
    limit:       "10",
    sort:        "price",
    asc:         "1",
    one_for_city: "1",   // melhor preço por par origem-destino
  })

  if (params.returnDate) {
    qs.set("return_from", toKiwiDate(params.returnDate))
    qs.set("return_to",   toKiwiDate(params.returnDate))
  }

  const res = await fetch(`${BASE_URL}/v2/search?${qs}`, {
    headers: {
      "apikey": process.env.KIWI_API_KEY!,
      "Accept": "application/json",
    },
  })

  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) return null
    await sleep(2000)
    return fetchFlightPrice(params, attempt + 1)
  }

  if (!res.ok) {
    console.error(`[Kiwi] ${res.status} para ${params.origin}→${params.destination}`)
    return null
  }

  const body: KiwiSearchResponse = await res.json()
  const offers = body.data ?? []

  if (offers.length === 0) return null

  const best = offers[0]  // já vem ordenado por preço
  const airline = best.airlines?.[0] ?? best.operating_carrier ?? "XX"

  return {
    price:    best.price,
    currency: body.currency ?? params.currency,
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

// ─── Kiwi response types (parciais) ──────────────────────────────────────────

interface KiwiOffer {
  price:             number
  airlines:          string[]
  operating_carrier: string
  deep_link:         string
}

interface KiwiSearchResponse {
  data:     KiwiOffer[]
  currency: string
}

function toKiwiDate(d: Date | string): string {
  const iso = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
  const [y, m, day] = iso.split("-")
  return `${day}/${m}/${y}`   // Kiwi usa DD/MM/YYYY
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
