/**
 * SearchAPI Google Flights Service
 *
 * Baseado no OpenAPI spec oficial da searchapi.io.
 *
 * Cadastro: https://www.searchapi.io (email, acesso imediato)
 * Docs:     https://www.searchapi.io/docs/google-flights-api
 *
 * Destaques do spec que mudam a implementação:
 *
 *   1. travel_class: string ("economy" | "business" | "first_class")
 *      — não número como SerpAPI
 *
 *   2. flight_type: "one_way" | "round_trip" | "multi_city"
 *      — não type=1/2
 *
 *   3. booking_token por oferta → segunda chamada retorna
 *      booking_options[].booking_request.url (URL oficial da companhia)
 *      — elimina o deepLinkBuilder manual
 *
 *   4. price_insights inclui price_history, price_level ("low"/"typical"/"high"),
 *      typical_price_range, cheaper_alternatives
 *      — alimenta features premium diretamente
 *
 *   5. FlightSegment.flight_number contém o código IATA da companhia
 *      — "LA 8094" → "LA", "G3 1234" → "G3"
 *
 * Para usar: no priceEngine.ts:
 *   import { fetchFlightPrice } from "./searchApiService"
 */

import { buildDeepLink } from "./deepLinkBuilder"
import type { CabinClass } from "@prisma/client"

// ─── Exported interface (compatível com todos os outros services) ─────────────

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
  airline: string        // IATA code: "LA", "G3", "AD"…
  deepLink: string       // URL direta da companhia (via booking_token) ou fallback
  priceLevel?: "low" | "typical" | "high"   // bonus do price_insights
  bookingToken?: string  // guarda para buscar URL direta se necessário
}

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL  = "https://www.searchapi.io/api/v1/search"
const MAX_RETRY = 3

// Spec define: "economy" | "premium_economy" | "business" | "first_class"
const CABIN: Record<CabinClass, string> = {
  ECONOMY:  "economy",
  BUSINESS: "business",
  FIRST:    "first_class",
}

function authHeader(): Record<string, string> {
  return { "Authorization": `Bearer ${process.env.SEARCHAPI_KEY}` }
}

// ─── Busca de preço principal ─────────────────────────────────────────────────

export async function fetchFlightPrice(
  params: FetchPriceParams,
  attempt = 1
): Promise<PriceFetchResult | null> {
  const qs = new URLSearchParams({
    engine:        "google_flights",
    departure_id:  params.origin,
    arrival_id:    params.destination,
    outbound_date: toDate(params.departureDate),
    flight_type:   params.returnDate ? "round_trip" : "one_way",
    travel_class:  CABIN[params.cabinClass],
    adults:        String(params.adults),
    currency:      params.currency,
    hl:            "pt-BR",
    gl:            "BR",
    sort_by:       "price",
    show_cheapest_flights: "true",
  })

  if (params.returnDate) qs.set("return_date", toDate(params.returnDate))

  const res = await fetch(`${BASE_URL}?${qs}`, { headers: authHeader() })

  // 429 — rate limit
  if (res.status === 429) {
    if (attempt >= MAX_RETRY) return null
    const wait = parseInt(res.headers.get("Retry-After") ?? "5", 10)
    await sleep(wait * 1000)
    return fetchFlightPrice(params, attempt + 1)
  }

  // 401 — key inválida
  if (res.status === 401) {
    console.error("[SearchAPI] Chave inválida ou expirada")
    return null
  }

  // 400 — parâmetros inválidos (rota inexistente, data passada etc)
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}))
    console.warn(
      `[SearchAPI] 400 ${params.origin}→${params.destination}:`,
      (body as any)?.error ?? "parâmetros inválidos"
    )
    return null
  }

  // 503 — timeout do Google Flights (acontece ~2% das vezes)
  if (res.status === 503) {
    if (attempt >= MAX_RETRY) return null
    await sleep(3000)
    return fetchFlightPrice(params, attempt + 1)
  }

  if (!res.ok) {
    console.error(`[SearchAPI] ${res.status} para ${params.origin}→${params.destination}`)
    return null
  }

  const body: SearchApiResponse = await res.json()

  // Verifica erro semântico (search_metadata.status pode ser "Error")
  if (body.error) {
    console.warn(`[SearchAPI] Erro semântico: ${body.error}`)
    return null
  }

  const allFlights = [...(body.best_flights ?? []), ...(body.other_flights ?? [])]
  if (!allFlights.length) return null

  // Ordena por preço e pega o mais barato
  const best = allFlights.sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0]
  if (!best.price) return null

  // Extrai IATA code do flight_number (ex: "LA 8094" → "LA", "G3 1234" → "G3")
  const airline = extractIata(best, body.airlines)

  // Usa o booking_token para obter a URL direta da companhia (1 call extra)
  // Só faz isso quando o preço realmente caiu (lógica no priceEngine)
  // Aqui apenas guarda o token para uso posterior
  const bookingToken = best.booking_token

  // deepLink: tenta via booking_token se disponível, senão usa builder
  // Para o ciclo de polling, usa builder (0 calls extras)
  // Para notificação, o priceEngine pode chamar fetchDirectAirlineUrl()
  const deepLink = buildDeepLink({
    airline,
    origin:        params.origin,
    destination:   params.destination,
    departureDate: params.departureDate,
    returnDate:    params.returnDate,
    adults:        params.adults,
    cabinClass:    params.cabinClass,
  })

  return {
    price:        best.price,
    currency:     params.currency,
    airline,
    deepLink,
    priceLevel:   body.price_insights?.price_level,
    bookingToken,
  }
}

// ─── Booking URL direta (2ª chamada, usar só ao disparar notificação) ─────────

/**
 * Dado um booking_token, retorna a URL oficial da companhia para reserva.
 * SearchAPI retorna booking_options onde book_with é a companhia.
 *
 * Usar no priceEngine.ts apenas quando há queda real de preço:
 *
 *   const result = await fetchFlightPrice(params)
 *   if (result?.bookingToken && priceDropped) {
 *     const directUrl = await fetchDirectAirlineUrl(result.bookingToken)
 *     if (directUrl) result.deepLink = directUrl
 *   }
 */
export async function fetchDirectAirlineUrl(
  bookingToken: string
): Promise<string | null> {
  const qs = new URLSearchParams({
    engine:        "google_flights",
    booking_token: bookingToken,
  })

  const res = await fetch(`${BASE_URL}?${qs}`, { headers: authHeader() })
  if (!res.ok) return null

  const body: SearchApiResponse = await res.json()
  const options = body.booking_options ?? []

  // Filtra opções onde book_with NÃO é uma OTA
  const airlineOption = options.find(
    (opt) => opt.booking_request?.url && !isOta(opt.book_with)
  )

  return airlineOption?.booking_request?.url ?? null
}

// ─── price_insights: dados premium da rota ────────────────────────────────────

export interface RouteInsights {
  lowestPrice: number
  priceLevel: "low" | "typical" | "high"
  typicalRange: { low: number; high: number }
  priceHistory: Array<{ date: string; price: number }>
  estimatedSavings?: number
  cheaperAlternatives: Array<{ departure: string; return?: string; price: number }>
}

/**
 * Busca price_insights completos para uma rota.
 * Usar para alimentar o painel premium de tendências.
 */
export async function fetchRouteInsights(
  params: FetchPriceParams
): Promise<RouteInsights | null> {
  const qs = new URLSearchParams({
    engine:        "google_flights",
    departure_id:  params.origin,
    arrival_id:    params.destination,
    outbound_date: toDate(params.departureDate),
    flight_type:   params.returnDate ? "round_trip" : "one_way",
    travel_class:  CABIN[params.cabinClass],
    adults:        String(params.adults),
    currency:      params.currency,
    hl:            "pt-BR",
    gl:            "BR",
  })

  if (params.returnDate) qs.set("return_date", toDate(params.returnDate))

  const res = await fetch(`${BASE_URL}?${qs}`, { headers: authHeader() })
  if (!res.ok) return null

  const body: SearchApiResponse = await res.json()
  const pi = body.price_insights
  if (!pi) return null

  return {
    lowestPrice:   pi.lowest_price,
    priceLevel:    pi.price_level,
    typicalRange:  {
      low:  pi.typical_price_range?.low_price  ?? 0,
      high: pi.typical_price_range?.high_price ?? 0,
    },
    priceHistory: (pi.price_history ?? []).map((h) => ({
      date:  h.iso_date,
      price: h.price,
    })),
    estimatedSavings: pi.cheapest_to_book?.estimated_savings,
    cheaperAlternatives: (body.cheaper_alternatives ?? []).map((a) => ({
      departure: a.departure,
      return:    a.return,
      price:     a.price,
    })),
  }
}

// ─── OpenAPI spec types ───────────────────────────────────────────────────────

interface FlightSegment {
  airline:           string          // nome: "LATAM Airlines"
  flight_number:     string          // "LA 8094"
  departure_airport: { id: string; time: string }
  arrival_airport:   { id: string; time: string }
  duration:          number
}

interface Flight {
  flights:       FlightSegment[]
  price:         number
  booking_token: string
  departure_token?: string
  total_duration: number
  carbon_emissions?: { this_flight: number; difference_percent: number }
}

interface BookingOption {
  book_with:       string
  price:           number
  booking_request?: { url: string; post_data?: string }
  fare_type?:      string
}

interface PriceInsights {
  lowest_price:        number
  price_level:         "low" | "typical" | "high"
  typical_price_range: { low_price: number; high_price: number }
  price_history:       Array<{ price: number; iso_date: string }>
  cheapest_to_book?:   { estimated_savings: number }
}

interface Airlines {
  airlines: Array<{ code: string; name: string }>
}

interface SearchApiResponse {
  error?:               string
  best_flights?:        Flight[]
  other_flights?:       Flight[]
  price_insights?:      PriceInsights
  booking_options?:     BookingOption[]
  airlines?:            Airlines
  cheaper_alternatives?: Array<{ departure: string; return: string; price: number }>
}

// ─── IATA extraction ──────────────────────────────────────────────────────────

/**
 * Extrai o código IATA da companhia a partir do flight_number.
 * O spec mostra flight_number no formato "LA 8094" ou "LA8094".
 * Fallback: procura na lista de companhias da resposta pelo nome.
 */
function extractIata(flight: Flight, airlinesData?: Airlines): string {
  const seg = flight.flights?.[0]
  if (!seg) return "XX"

  // Tenta extrair do flight_number: "LA 8094" → "LA", "G3 1234" → "G3"
  const fnMatch = seg.flight_number?.match(/^([A-Z0-9]{2,3})\s*\d+/)
  if (fnMatch) return fnMatch[1]

  // Fallback: cruza nome da companhia com a lista de IATA da resposta
  if (airlinesData?.airlines && seg.airline) {
    const match = airlinesData.airlines.find(
      (a) => a.name.toLowerCase() === seg.airline.toLowerCase()
    )
    if (match?.code) return match.code
  }

  // Último fallback: 2 primeiras letras maiúsculas do nome
  return seg.airline?.replace(/[^A-Z]/g, "").slice(0, 2) || "XX"
}

// ─── OTA detection ────────────────────────────────────────────────────────────

const OTA_NAMES = new Set([
  "expedia", "kayak", "booking.com", "priceline", "orbitz",
  "travelocity", "hotwire", "cheapoair", "cheapflights",
  "skyscanner", "momondo", "google", "kiwi", "trip.com",
  "travix", "bravofly", "vayama", "flightnetwork",
])

function isOta(bookWith: string): boolean {
  const lower = (bookWith ?? "").toLowerCase()
  return OTA_NAMES.has(lower) || [...OTA_NAMES].some((ota) => lower.includes(ota))
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function toDate(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
