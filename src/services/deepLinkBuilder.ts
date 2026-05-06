/**
 * DeepLink Builder
 *
 * Constrói a URL direta para o site oficial de cada companhia aérea.
 * Quando o usuário clica em "Ver voo" na notificação, cai na página
 * de busca da própria companhia — nunca em um OTA ou intermediário.
 *
 * Padrão de URL: cada companhia tem um formato diferente.
 * Para companhias desconhecidas: fallback para Google Flights,
 * que por sua vez linka para o site oficial da companhia.
 *
 * Atualizar esse mapa conforme novas companhias forem adicionadas.
 * Testar manualmente quando uma companhia mudar o formato de URL.
 */

import type { CabinClass } from "@prisma/client"

export interface DeepLinkParams {
  airline: string
  origin: string
  destination: string
  departureDate: Date | string
  returnDate?: Date | string
  adults: number
  cabinClass: CabinClass
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function buildDeepLink(params: DeepLinkParams): string {
  const builder = AIRLINE_BUILDERS[params.airline.toUpperCase()]
  if (builder) {
    try {
      return builder(params)
    } catch {
      // Se o builder falhar, cai no fallback
    }
  }
  return googleFlightsFallback(params)
}

// ─── Airline builders ─────────────────────────────────────────────────────────

type Builder = (p: DeepLinkParams) => string

const AIRLINE_BUILDERS: Record<string, Builder> = {

  // ── LATAM (LA / JJ) ──────────────────────────────────────────────────────
  // https://www.latamairlines.com/br/pt/oferta-voos?origin=GRU&destination=LHR&outbound=2025-06-15&adt=1
  LA: (p) => {
    const q = new URLSearchParams({
      origin:      p.origin,
      destination: p.destination,
      outbound:    toDate(p.departureDate),
      adt:         String(p.adults),
      inf:         "0",
      chd:         "0",
      cabin:       latamCabin(p.cabinClass),
      redemption:  "false",
      sort:        "RECOMMENDED",
    })
    if (p.returnDate) q.set("inbound", toDate(p.returnDate))
    return `https://www.latamairlines.com/br/pt/oferta-voos?${q}`
  },

  JJ: (p) => AIRLINE_BUILDERS.LA(p),  // LATAM legacy code

  // ── GOL (G3) ──────────────────────────────────────────────────────────────
  // https://www.voegol.com.br/pt-br/passagens-aereas?departureAirport=GRU&arrivalAirport=LHR…
  G3: (p) => {
    const q = new URLSearchParams({
      departureAirport: p.origin,
      arrivalAirport:   p.destination,
      departureDate:    toBrDate(p.departureDate),
      adults:           String(p.adults),
      children:         "0",
      infants:          "0",
      tripType:         p.returnDate ? "ROUND_TRIP" : "ONE_WAY",
      cabin:            golCabin(p.cabinClass),
    })
    if (p.returnDate) q.set("returnDate", toBrDate(p.returnDate))
    return `https://www.voegol.com.br/pt-br/passagens-aereas?${q}`
  },

  // ── Azul (AD) ─────────────────────────────────────────────────────────────
  // Azul não tem deeplink estável — manda para home com pré-seleção de origem
  AD: (p) => {
    const q = new URLSearchParams({
      origem:   p.origin,
      destino:  p.destination,
      ida:      toDate(p.departureDate),
      adultos:  String(p.adults),
    })
    return `https://www.voeazul.com.br/comprar/passagens?${q}`
  },

  // ── TAP Air Portugal (TP) ─────────────────────────────────────────────────
  TP: (p) => {
    const q = new URLSearchParams({
      origin:      p.origin,
      destination: p.destination,
      date:        toDate(p.departureDate),
      adults:      String(p.adults),
      children:    "0",
      infants:     "0",
      tripType:    p.returnDate ? "ROUNDTRIP" : "ONEWAY",
      cabin:       tapCabin(p.cabinClass),
    })
    if (p.returnDate) q.set("returnDate", toDate(p.returnDate))
    return `https://www.flytap.com/pt-pt/flights?${q}`
  },

  // ── Iberia (IB) ───────────────────────────────────────────────────────────
  IB: (p) => {
    const q = new URLSearchParams({
      adults:  String(p.adults),
      lang:    "pt_BR",
      origin1: p.origin,
      dest1:   p.destination,
      cabin:   iberiaCabin(p.cabinClass),
      date1:   toDate(p.departureDate),
    })
    return `https://www.iberia.com/pt/offers/flights/search/?${q}`
  },

  // ── American Airlines (AA) ────────────────────────────────────────────────
  AA: (p) => {
    const q = new URLSearchParams({
      locale:        "pt_BR",
      pax:           "ADT",
      from:          p.origin,
      to:            p.destination,
      outboundDate:  toDate(p.departureDate),
      cabin:         aaCabin(p.cabinClass),
      adult:         String(p.adults),
    })
    if (p.returnDate) q.set("returnDate", toDate(p.returnDate))
    return `https://www.aa.com/booking/find-flights/basic?${q}`
  },

  // ── British Airways (BA) ──────────────────────────────────────────────────
  BA: (p) => {
    const q = new URLSearchParams({
      from:          p.origin,
      to:            p.destination,
      depart:        toDate(p.departureDate),
      numAdults:     String(p.adults),
      numChildren:   "0",
      cabin:         baCabin(p.cabinClass),
      tripType:      p.returnDate ? "return" : "single",
    })
    if (p.returnDate) q.set("return", toDate(p.returnDate))
    return `https://www.britishairways.com/travel/redapp/public/en_br?${q}`
  },

  // ── Lufthansa (LH) ────────────────────────────────────────────────────────
  LH: (p) => {
    const q = new URLSearchParams({
      origin:      p.origin,
      destination: p.destination,
      outwardDate: toDate(p.departureDate),
      adults:      String(p.adults),
      cabin:       lhCabin(p.cabinClass),
    })
    if (p.returnDate) q.set("returnDate", toDate(p.returnDate))
    return `https://www.lufthansa.com/br/pt/homepage#/offers/flightoffers?${q}`
  },

  // ── Air France (AF) ───────────────────────────────────────────────────────
  AF: (p) => {
    const q = new URLSearchParams({
      origin:      p.origin,
      destination: p.destination,
      date:        toDate(p.departureDate),
      adults:      String(p.adults),
      cabin:       afCabin(p.cabinClass),
      _cmpL:       "pt_BR",
    })
    return `https://wwws.airfrance.com.br/information/application/vols/recherche?${q}`
  },

  // ── KLM (KL) ──────────────────────────────────────────────────────────────
  KL: (p) => {
    const q = new URLSearchParams({
      origin:      p.origin,
      destination: p.destination,
      outboundDate: toDate(p.departureDate),
      adults:      String(p.adults),
      cabin:       klmCabin(p.cabinClass),
      languageId:  "pt_BR",
    })
    if (p.returnDate) q.set("inboundDate", toDate(p.returnDate))
    return `https://www.klm.com.br/information/application/vols/recherche?${q}`
  },

  // ── United (UA) ───────────────────────────────────────────────────────────
  UA: (p) => {
    const q = new URLSearchParams({
      f:       p.origin,
      t:       p.destination,
      d:       toDate(p.departureDate),
      sc:      uaCabin(p.cabinClass),
      px:      String(p.adults),
      taxng:   "1",
      newHP:   "True",
    })
    return `https://www.united.com/ual/pt/br/flight-search/book-a-flight/results/afs?${q}`
  },

  // ── Delta (DL) ────────────────────────────────────────────────────────────
  DL: (p) => {
    const q = new URLSearchParams({
      tripType:       p.returnDate ? "R" : "O",
      fromAirportCode: p.origin,
      toAirportCode:   p.destination,
      departureDate:   toDate(p.departureDate),
      pax:             String(p.adults),
      cabin:           deltaCabin(p.cabinClass),
      fareClass:       "BE",
    })
    if (p.returnDate) q.set("returnDate", toDate(p.returnDate))
    return `https://www.delta.com/br/pt/booking-information/flight-search?${q}`
  },

  // ── Emirates (EK) ─────────────────────────────────────────────────────────
  EK: (p) => {
    const q = new URLSearchParams({
      "widget-origin":      p.origin,
      "widget-destination": p.destination,
      "widget-departureDate": toDate(p.departureDate),
      "widget-class":       ekCabin(p.cabinClass),
      "widget-adults":      String(p.adults),
    })
    return `https://www.emirates.com/br/portuguese/book/flights/?${q}`
  },

}

// ─── Fallback: Google Flights ────────────────────────────────────────────────

/**
 * Para companhias sem builder ou builders com falha.
 * Google Flights mostra o voo e linka para o site oficial da companhia.
 * Não é uma venda direta, mas redireciona para o canal oficial no clique.
 */
function googleFlightsFallback(p: DeepLinkParams): string {
  const q = new URLSearchParams({
    q: `voos de ${p.origin} para ${p.destination} em ${toDate(p.departureDate)}`,
  })
  return `https://www.google.com/travel/flights?${q}`
}

// ─── Cabin class mappers por companhia ────────────────────────────────────────

function latamCabin(c: CabinClass)   { return c === "ECONOMY" ? "Y" : c === "BUSINESS" ? "C" : "F" }
function golCabin(c: CabinClass)     { return c === "ECONOMY" ? "ECONOMIC" : "EXECUTIVE" }
function tapCabin(c: CabinClass)     { return c === "ECONOMY" ? "EC" : c === "BUSINESS" ? "BI" : "FI" }
function iberiaCabin(c: CabinClass)  { return c === "ECONOMY" ? "T" : c === "BUSINESS" ? "C" : "F" }
function aaCabin(c: CabinClass)      { return c === "ECONOMY" ? "coach" : c === "BUSINESS" ? "business" : "first" }
function baCabin(c: CabinClass)      { return c === "ECONOMY" ? "M" : c === "BUSINESS" ? "C" : "F" }
function lhCabin(c: CabinClass)      { return c === "ECONOMY" ? "ECO" : c === "BUSINESS" ? "BSN" : "FST" }
function afCabin(c: CabinClass)      { return c === "ECONOMY" ? "ec" : c === "BUSINESS" ? "bu" : "fi" }
function klmCabin(c: CabinClass)     { return afCabin(c) }
function uaCabin(c: CabinClass)      { return c === "ECONOMY" ? "ECONOMY" : c === "BUSINESS" ? "BUSINESS" : "FIRST" }
function deltaCabin(c: CabinClass)   { return c === "ECONOMY" ? "COACH" : c === "BUSINESS" ? "BUSINESS" : "FIRST" }
function ekCabin(c: CabinClass)      { return c === "ECONOMY" ? "Economy" : c === "BUSINESS" ? "Business" : "First" }

// ─── Date utils ───────────────────────────────────────────────────────────────

function toDate(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

function toBrDate(d: Date | string): string {
  const [y, m, day] = toDate(d).split("-")
  return `${day}/${m}/${y}`
}
