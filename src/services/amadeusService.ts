/**
 * Amadeus Service
 *
 * Responsabilidades:
 *   1. OAuth2 client_credentials com token cacheado no Redis (30 min)
 *   2. GET /v2/shopping/flight-offers — busca de preços
 *   3. Rate limiting: 1 req/s no free tier (com throttle interno)
 *   4. Retry automático em 429 e 401
 *
 * Docs: https://developers.amadeus.com/self-service/category/flights
 */

import { redis } from "../cache/priceCache"
import { buildDeepLink } from "./deepLinkBuilder"
import type { CabinClass } from "@prisma/client"

export interface FetchPriceParams {
  origin: string
  destination: string
  departureDate: Date | string
  returnDate?: Date | string
  adults: number
  cabinClass: CabinClass
  currency: string
}

export interface PriceFetchResult {
  price: number
  currency: string
  airline: string     // IATA: "LA", "G3", "AD"…
  deepLink: string    // URL direta para o site da companhia
}

const BASE_URL = process.env.AMADEUS_ENV === "production"
  ? "https://api.amadeus.com"
  : "https://test.api.amadeus.com"

const TOKEN_KEY     = "amadeus:token"
const TOKEN_BUFFER  = 60       // renova 60s antes de expirar
const RATE_DELAY_MS = 1050     // free tier: 1 req/s
const MAX_RETRIES   = 3

const CABIN: Record<CabinClass, string> = {
  ECONOMY:  "ECONOMY",
  BUSINESS: "BUSINESS",
  FIRST:    "FIRST",
}

// ─── Token ────────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  try {
    const hit = await redis.get(TOKEN_KEY)
    if (hit) return hit
  } catch { /* Redis indisponível — continua */ }

  const res = await fetch(`${BASE_URL}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     process.env.AMADEUS_CLIENT_ID!,
      client_secret: process.env.AMADEUS_CLIENT_SECRET!,
    }).toString(),
  })

  if (!res.ok) throw new Error(`Amadeus auth failed: ${res.status} ${await res.text()}`)

  const { access_token, expires_in }: { access_token: string; expires_in: number } = await res.json()

  try { await redis.setEx(TOKEN_KEY, expires_in - TOKEN_BUFFER, access_token) } catch { /* ok */ }

  return access_token
}

// ─── Throttle (1 req/s) ───────────────────────────────────────────────────────

let lastCall = 0
async function throttle() {
  const wait = RATE_DELAY_MS - (Date.now() - lastCall)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
}

// ─── Flight Offers Search ─────────────────────────────────────────────────────

export async function fetchFlightPrice(
  params: FetchPriceParams,
  attempt = 1
): Promise<PriceFetchResult | null> {
  await throttle()
  const token = await getToken()

  const qs = new URLSearchParams({
    originLocationCode:      params.origin,
    destinationLocationCode: params.destination,
    departureDate:           toDate(params.departureDate),
    adults:                  String(params.adults),
    travelClass:             CABIN[params.cabinClass],
    currencyCode:            params.currency,
    max:                     "10",
    nonStop:                 "false",
  })
  if (params.returnDate) qs.set("returnDate", toDate(params.returnDate))

  const res = await fetch(`${BASE_URL}/v2/shopping/flight-offers?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  // 429 — rate limit: espera Retry-After e tenta de novo
  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) return null
    const wait = parseInt(res.headers.get("Retry-After") ?? "2", 10)
    await new Promise((r) => setTimeout(r, wait * 1000))
    return fetchFlightPrice(params, attempt + 1)
  }

  // 401 — token expirou (race): invalida cache e reautentica
  if (res.status === 401) {
    await redis.del(TOKEN_KEY).catch(() => {})
    if (attempt >= MAX_RETRIES) return null
    return fetchFlightPrice(params, attempt + 1)
  }

  if (res.status === 400) {
    // Rota inválida, data passada etc — não é erro de infra
    const body = await res.json().catch(() => ({}))
    console.warn(`[Amadeus] 400 ${params.origin}→${params.destination}:`, (body as any)?.errors?.[0]?.detail)
    return null
  }

  if (!res.ok) {
    console.error(`[Amadeus] ${res.status} para ${params.origin}→${params.destination}`)
    return null
  }

  const { data: offers = [] }: { data: AmadeusOffer[] } = await res.json()
  if (!offers.length) return null

  // Ordena por grandTotal, pega o mais barato
  const best = offers.sort(
    (a, b) => parseFloat(a.price.grandTotal) - parseFloat(b.price.grandTotal)
  )[0]

  const airline = best.validatingAirlineCodes?.[0]
    ?? best.itineraries[0]?.segments[0]?.carrierCode
    ?? "XX"

  return {
    price:    parseFloat(best.price.grandTotal),
    currency: best.price.currency,
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

// ─── Partial Amadeus types ────────────────────────────────────────────────────

interface AmadeusOffer {
  price: { grandTotal: string; currency: string }
  validatingAirlineCodes?: string[]
  itineraries: Array<{ segments: Array<{ carrierCode: string }> }>
}

function toDate(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}
