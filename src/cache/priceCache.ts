/**
 * Price Cache — Redis deduplication layer
 *
 * Problema sem cache:
 *   1000 watches, 200 rotas únicas → 1000 calls Amadeus por ciclo de 2 min
 *   Amadeus Free: 1 req/s → 1000 calls levaria >16 min. Impossível.
 *
 * Com Redis:
 *   1000 watches, 200 rotas únicas → 200 calls Amadeus por ciclo
 *   Watches com a mesma rota leem do cache. Zero calls redundantes.
 *
 * TTL = 2 min (igual ao intervalo do cron).
 * Chave: `price:{origin}:{destination}:{date}:{cabin}:{currency}`
 */

import { createClient } from "redis"
import type { CabinClass } from "@prisma/client"
import type { FetchPriceParams, PriceFetchResult } from "../services/searchApiService"

const CACHE_TTL_SECONDS = 120  // 2 minutos

const redis = createClient({
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
})

redis.on("error", (err) => console.error("[Redis] Erro:", err))

let connected = false

async function ensureConnected() {
  if (!connected) {
    await redis.connect()
    connected = true
  }
}

// ─── Cache key ─────────────────────────────────────────────────────────────────

function buildKey(params: FetchPriceParams): string {
  const date = params.departureDate instanceof Date
    ? params.departureDate.toISOString().slice(0, 10)
    : params.departureDate
  return [
    "price",
    params.origin,
    params.destination,
    date,
    params.cabinClass,
    params.currency,
    params.adults,
  ].join(":")
}

// ─── Fetch com cache ───────────────────────────────────────────────────────────

export async function getPriceCached(
  params: FetchPriceParams,
  fetcher: (p: FetchPriceParams) => Promise<PriceFetchResult | null>
): Promise<PriceFetchResult | null> {
  await ensureConnected()

  const key = buildKey(params)

  // 1. Tenta ler do cache
  try {
    const cached = await redis.get(key)
    if (cached) {
      return JSON.parse(cached) as PriceFetchResult
    }
  } catch (err) {
    console.warn("[Cache] Erro ao ler Redis, buscando direto:", err)
  }

  // 2. Cache miss → chama Amadeus
  const result = await fetcher(params)

  if (result) {
    // 3. Armazena no cache por 2 min
    try {
      await redis.setEx(key, CACHE_TTL_SECONDS, JSON.stringify(result))
    } catch (err) {
      console.warn("[Cache] Erro ao escrever Redis:", err)
      // Continua — cache write failure não é crítico
    }
  }

  return result
}

// ─── Invalidação manual (admin) ───────────────────────────────────────────────

export async function invalidatePriceCache(params: Partial<FetchPriceParams>) {
  await ensureConnected()
  const pattern = `price:${params.origin ?? "*"}:${params.destination ?? "*"}:*`
  const keys = await redis.keys(pattern)
  if (keys.length > 0) {
    await redis.del(keys)
    console.log(`[Cache] ${keys.length} chaves invalidadas para ${pattern}`)
  }
}

// ─── Health check ──────────────────────────────────────────────────────────────

export async function getCacheStats() {
  await ensureConnected()
  const info = await redis.info("stats")
  const keyCount = await redis.dbSize()
  return { keyCount, info }
}

export { redis }
