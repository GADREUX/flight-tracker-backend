/**
 * SerpAPI Google Flights Service
 *
 * Acesso imediato para brasileiros — só precisa de email.
 * Usa os dados do Google Flights (preços reais das companhias).
 *
 * Cadastro: https://serpapi.com/users/sign_up
 * Dashboard: https://serpapi.com/dashboard (pegar API key)
 * Docs:      https://serpapi.com/google-flights-api
 *
 * Planos:
 *   Free:  100 buscas/mês
 *   Hobby: $50/mês → 5.000 buscas
 *   Biz:   $150/mês → 15.000 buscas
 *
 * Para usar: trocar import no priceEngine.ts:
 *   import { fetchFlightPrice } from "./serpApiService"
 */

import { buildDeepLink } from "./deepLinkBuilder"
import type { CabinClass } from "@prisma/client"
import type { FetchPriceParams, PriceFetchResult } from "./duffelService"

export type { FetchPriceParams, PriceFetchResult }

const BASE_URL  = "https://serpapi.com/search.json"
const MAX_RETRY = 3

// SerpAPI travel_class: 1=Economy 2=PremiumEconomy 3=Business 4=First
const CABIN: Record<CabinClass, string> = {
  ECONOMY:  "1",
  BUSINESS: "3",
  FIRST:    "4",
}

// ─── Airline name → IATA (Google retorna nomes, não códigos) ─────────────────
const AIRLINE_TO_IATA: Record<string, string> = {
  "LATAM Airlines":          "LA",
  "LATAM":                   "LA",
  "GOL":                     "G3",
  "Gol Linhas Aéreas":       "G3",
  "Azul":                    "AD",
  "Azul Brazilian Airlines": "AD",
  "TAP Air Portugal":        "TP",
  "Iberia":                  "IB",
  "American Airlines":       "AA",
  "British Airways":         "BA",
  "Lufthansa":               "LH",
  "Air France":              "AF",
  "KLM":                     "KL",
  "United Airlines":         "UA",
  "Delta":                   "DL",
  "Delta Air Lines":         "DL",
  "Emirates":                "EK",
  "Turkish Airlines":        "TK",
  "Aeromexico":              "AM",
  "Copa Airlines":           "CM",
  "Avianca":                 "AV",
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function fetchFlightPrice(
  params: FetchPriceParams,
  attempt = 1
): Promise<PriceFetchResult | null> {
  const qs = new URLSearchParams({
    engine:          "google_flights",
    departure_id:    params.origin,
    arrival_id:      params.destination,
    outbound_date:   toDate(params.departureDate),
    travel_class:    CABIN[params.cabinClass],
    adults:          String(params.adults),
    currency:        params.currency,
    hl:              "pt",
    gl:              "br",
    api_key:         process.env.SERPAPI_KEY!,
  })

  if (params.returnDate) {
    qs.set("return_date", toDate(params.returnDate))
    qs.set("type", "1")   // 1 = round trip
  } else {
    qs.set("type", "2")   // 2 = one way
  }

  const res = await fetch(`${BASE_URL}?${qs}`)

  if (res.status === 429) {
    if (attempt >= MAX_RETRY) return null
    await sleep(3000)
    return fetchFlightPrice(params, attempt + 1)
  }

  if (!res.ok) {
    const body = await res.text()
    console.error(`[SerpAPI] ${res.status}:`, body.slice(0, 200))
    return null
  }

  const data: SerpFlightsResponse = await res.json()

  // SerpAPI retorna "best_flights" e "other_flights" — junta e pega o mais barato
  const all = [...(data.best_flights ?? []), ...(data.other_flights ?? [])]
  if (all.length === 0) return null

  const best = all.sort((a, b) => a.price - b.price)[0]
  if (!best.price) return null

  const airlineName = best.flights?.[0]?.airline ?? ""
  const airline = AIRLINE_TO_IATA[airlineName] ?? airlineNameToIata(airlineName)

  return {
    price:    best.price,
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

// ─── SerpAPI response types ───────────────────────────────────────────────────

interface SerpFlight {
  airline:           string
  airline_logo?:     string
  departure_airport: { id: string; time: string }
  arrival_airport:   { id: string; time: string }
  duration:          number
  airplane?:         string
  travel_class:      string
  flight_number:     string
}

interface SerpFlightOption {
  flights:            SerpFlight[]
  total_duration:     number
  price:              number
  type:               string
  airline_logo?:      string
  departure_token?:   string
}

interface SerpFlightsResponse {
  best_flights?:    SerpFlightOption[]
  other_flights?:   SerpFlightOption[]
  price_insights?: {
    lowest_price:   number
    price_level:    string   // "low" | "typical" | "high"
    typical_price_range: [number, number]
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

/**
 * Tenta extrair o código IATA a partir do nome da companhia.
 * Pega as duas primeiras letras maiúsculas como aproximação.
 * Fallback seguro — o deepLinkBuilder tem fallback para Google Flights.
 */
function airlineNameToIata(name: string): string {
  const upper = name.toUpperCase()
  for (const [key, code] of Object.entries(AIRLINE_TO_IATA)) {
    if (upper.includes(key.toUpperCase())) return code
  }
  // Usa as 2 primeiras letras como código aproximado (melhor que nada)
  return name.replace(/[^A-Z]/gi, "").slice(0, 2).toUpperCase() || "XX"
}

function toDate(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
