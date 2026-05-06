/**
 * Duffel Service — substituto direto do amadeusService.ts
 *
 * Por que Duffel em vez de Amadeus?
 *   - Cadastro imediato (email, sem aprovação empresarial)
 *   - Auth mais simples: Bearer token estático, sem OAuth2
 *   - API moderna (REST/JSON limpo, sem SOAP/GDS legado)
 *   - Mesmo inventário: acessa GDS IATA diretamente
 *
 * Swap no priceEngine.ts:
 *   - import { fetchFlightPrice } from "./amadeusService"
 *   + import { fetchFlightPrice } from "./duffelService"
 *
 * Docs: https://duffel.com/docs/api/overview/welcome
 * Sandbox: token começa com "duffel_test_..."
 * Produção: token começa com "duffel_live_..."
 *
 * Nota sobre moeda:
 *   Duffel retorna o preço na moeda nativa da oferta.
 *   Rotas domésticas brasileiras → BRL.
 *   Rotas internacionais → USD ou EUR (depende da companhia).
 *   O campo `currency` do resultado reflete isso corretamente.
 *   Para comparação de variação de preço, a moeda precisa ser
 *   consistente — o priceEngine compara snapshot com snapshot
 *   da mesma rota, então a moeda se mantém estável.
 */

import { buildDeepLink } from "./deepLinkBuilder"
import type { CabinClass } from "@prisma/client"

export interface FetchPriceParams {
  origin: string
  destination: string
  departureDate: Date | string
  returnDate?: Date | string
  adults: number
  cabinClass: CabinClass
  currency: string   // hint preferencial — Duffel retorna moeda nativa
}

export interface PriceFetchResult {
  price: number
  currency: string
  airline: string
  deepLink: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.duffel.com"
const API_VERSION = "v2"
const MAX_RETRIES = 3

function headers(): Record<string, string> {
  return {
    "Authorization":  `Bearer ${process.env.DUFFEL_ACCESS_TOKEN}`,
    "Duffel-Version": API_VERSION,
    "Content-Type":   "application/json",
    "Accept":         "application/json",
  }
}

const CABIN: Record<CabinClass, string> = {
  ECONOMY:  "economy",
  BUSINESS: "business",
  FIRST:    "first",
}

// ─── Flight search ────────────────────────────────────────────────────────────

/**
 * Cria um offer request e retorna ofertas em uma única chamada
 * usando o parâmetro ?return_offers=true.
 *
 * Duffel retorna até 200 ofertas. Pegamos a mais barata.
 */
export async function fetchFlightPrice(
  params: FetchPriceParams,
  attempt = 1
): Promise<PriceFetchResult | null> {
  const slices: DuffelSlice[] = [
    {
      origin:          params.origin,
      destination:     params.destination,
      departure_date:  toDate(params.departureDate),
    },
  ]

  if (params.returnDate) {
    slices.push({
      origin:         params.destination,
      destination:    params.origin,
      departure_date: toDate(params.returnDate),
    })
  }

  const passengers = Array.from({ length: params.adults }, () => ({
    type: "adult" as const,
  }))

  const res = await fetch(`${BASE_URL}/air/offer_requests?return_offers=true`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      data: {
        slices,
        passengers,
        cabin_class: CABIN[params.cabinClass],
      },
    }),
  })

  // 429 — rate limit
  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) return null
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10)
    await sleep(retryAfter * 1000)
    return fetchFlightPrice(params, attempt + 1)
  }

  // 422 — rota inválida, aeroporto inexistente etc.
  if (res.status === 422) {
    const body = await res.json().catch(() => ({}))
    console.warn(
      `[Duffel] 422 ${params.origin}→${params.destination}:`,
      (body as any)?.errors?.[0]?.message ?? "parâmetros inválidos"
    )
    return null
  }

  if (!res.ok) {
    console.error(`[Duffel] ${res.status} para ${params.origin}→${params.destination}`)
    return null
  }

  const body: DuffelOfferRequestResponse = await res.json()
  const offers = body.data?.offers ?? []

  if (offers.length === 0) return null

  // Ordena pelo total_amount e pega o mais barato
  const best = offers.sort(
    (a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount)
  )[0]

  const airline = best.owner?.iata_code ?? extractCarrier(best)

  return {
    price:    parseFloat(best.total_amount),
    currency: best.total_currency,
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

// ─── Duffel response types (parciais) ────────────────────────────────────────

interface DuffelSlice {
  origin:         string
  destination:    string
  departure_date: string
}

interface DuffelOffer {
  id:             string
  total_amount:   string       // "3580.00"
  total_currency: string       // "BRL" | "USD" | "EUR" …
  expires_at:     string       // ISO timestamp
  owner?: {
    iata_code: string          // "LA", "G3" …
    name:      string
  }
  slices: Array<{
    segments: Array<{
      marketing_carrier: { iata_code: string }
      operating_carrier: { iata_code: string }
    }>
  }>
}

interface DuffelOfferRequestResponse {
  data: {
    id:     string
    offers: DuffelOffer[]
  }
}

function extractCarrier(offer: DuffelOffer): string {
  return (
    offer.slices?.[0]?.segments?.[0]?.marketing_carrier?.iata_code ?? "XX"
  )
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function toDate(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
