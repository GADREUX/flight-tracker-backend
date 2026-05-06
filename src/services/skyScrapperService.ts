/**
 * Sky Scrapper Service (via RapidAPI)
 *
 * Acessa dados do Skyscanner via RapidAPI. Backup se as outras APIs falharem.
 *
 * Cadastro: https://rapidapi.com/apiheya/api/sky-scrapper
 * Auth:     RapidAPI key (email + cartão no cadastro da plataforma)
 * Planos:   Free = 50 req/mês · Basic = $10/mês → 500 req
 *
 * Para usar: trocar import no priceEngine.ts:
 *   import { fetchFlightPrice } from "./skyScrapperService"
 */

import { buildDeepLink } from "./deepLinkBuilder"
import type { CabinClass } from "@prisma/client"
import type { FetchPriceParams, PriceFetchResult } from "./duffelService"

export type { FetchPriceParams, PriceFetchResult }

const BASE_URL = "https://sky-scrapper.p.rapidapi.com/api/v2/flights"
const MAX_RETRY = 3

const CABIN: Record<CabinClass, string> = {
  ECONOMY:  "economy",
  BUSINESS: "business",
  FIRST:    "first",
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function fetchFlightPrice(
  params: FetchPriceParams,
  attempt = 1
): Promise<PriceFetchResult | null> {
  // Sky Scrapper precisa de entityId do aeroporto — resolve primeiro
  const [originId, destId] = await Promise.all([
    resolveAirportId(params.origin),
    resolveAirportId(params.destination),
  ])

  if (!originId || !destId) {
    console.warn(`[SkyScrapper] Não foi possível resolver IDs: ${params.origin}, ${params.destination}`)
    return null
  }

  const qs = new URLSearchParams({
    originSkyId:          params.origin,
    destinationSkyId:     params.destination,
    originEntityId:       originId,
    destinationEntityId:  destId,
    date:                 toDate(params.departureDate),
    adults:               String(params.adults),
    cabinClass:           CABIN[params.cabinClass],
    currency:             params.currency,
    market:               "BR",
    countryCode:          "BR",
    locale:               "pt-BR",
    sortBy:               "best",
  })

  if (params.returnDate) qs.set("returnDate", toDate(params.returnDate))

  const res = await fetch(`${BASE_URL}/searchFlights?${qs}`, {
    headers: {
      "x-rapidapi-key":  process.env.RAPIDAPI_KEY!,
      "x-rapidapi-host": "sky-scrapper.p.rapidapi.com",
    },
  })

  if (res.status === 429) {
    if (attempt >= MAX_RETRY) return null
    await sleep(3000)
    return fetchFlightPrice(params, attempt + 1)
  }

  if (!res.ok) {
    console.error(`[SkyScrapper] ${res.status} para ${params.origin}→${params.destination}`)
    return null
  }

  const body: SkyScrapperResponse = await res.json()
  const itineraries = body.data?.itineraries ?? []
  if (!itineraries.length) return null

  // Já vem ordenado por "best" — pega o primeiro
  const best = itineraries[0]
  const price = best.price?.raw ?? 0
  if (!price) return null

  const carrier = best.legs?.[0]?.carriers?.marketing?.[0]
  const airline = carrier?.alternateId ?? carrier?.name?.slice(0, 2).toUpperCase() ?? "XX"

  return {
    price,
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

// ─── Airport ID cache + resolver ──────────────────────────────────────────────

// Cache em memória — IDs de aeroporto não mudam
const airportIdCache = new Map<string, string>()

// IDs pré-resolvidos dos principais aeroportos brasileiros e internacionais
// (evita chamadas desnecessárias à API de airport search)
const KNOWN_IDS: Record<string, string> = {
  GRU: "95673529", CGH: "95673541", GIG: "95673481", SDU: "95673617",
  BSB: "95673297", SSA: "95673563", FOR: "95673377", REC: "95673525",
  CWB: "95673313", POA: "95673509", BEL: "95673265", MAO: "95673441",
  LHR: "95565050", CDG: "95565041", JFK: "95565058", MIA: "95565075",
  LAX: "95565063", ORD: "95565060", FRA: "95565026", MAD: "95565021",
  LIS: "95565016", BCN: "95565022", AMS: "95565027", MXP: "95565032",
  DXB: "95673440", EZE: "95673305", BOG: "95673285", SCL: "95673547",
  LIM: "95673421", MEX: "95673449", YYZ: "95673633", NRT: "95673485",
}

async function resolveAirportId(iata: string): Promise<string | null> {
  if (KNOWN_IDS[iata]) return KNOWN_IDS[iata]
  if (airportIdCache.has(iata)) return airportIdCache.get(iata)!

  const qs = new URLSearchParams({ query: iata, locale: "pt-BR" })
  const res = await fetch(
    `https://sky-scrapper.p.rapidapi.com/api/v1/flights/searchAirport?${qs}`,
    {
      headers: {
        "x-rapidapi-key":  process.env.RAPIDAPI_KEY!,
        "x-rapidapi-host": "sky-scrapper.p.rapidapi.com",
      },
    }
  )

  if (!res.ok) return null

  const body = await res.json()
  const entityId: string | undefined = body.data?.[0]?.entityId
  if (entityId) airportIdCache.set(iata, entityId)
  return entityId ?? null
}

// ─── Response types ───────────────────────────────────────────────────────────

interface SkyScrapperResponse {
  data?: {
    itineraries: Array<{
      price?: { raw: number; formatted: string }
      legs?: Array<{
        carriers?: {
          marketing?: Array<{
            alternateId: string   // IATA code
            name:        string
          }>
        }
      }>
    }>
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function toDate(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
