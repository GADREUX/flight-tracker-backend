/**
 * Price Poller — Backend scheduler (v2: 2 min + Redis dedup)
 *
 * MUDANÇA:
 *   Antes: cron a cada 5h (extensão também fazia polling)
 *   Agora: cron a cada 2 min. Extensão não faz nada — só ouve pushes.
 *
 * Deduplicação Redis:
 *   Vários usuários podem monitorar a mesma rota (ex: GRU→LHR).
 *   Sem dedup, cada watch geraria um request Amadeus separado.
 *   Com Redis, a primeira query da rota é cacheada por 2 min —
 *   todos os watches seguintes da mesma rota leem do cache.
 *   Isso reduz calls Amadeus de N para ≈ número de rotas únicas.
 */

import cron from "node-cron"
import { prisma } from "../db/prisma"
import { checkPrice } from "../services/priceEngine"
import { getPriceCached } from "../cache/priceCache"

const POLL_CRON    = "*/2 * * * *"   // a cada 2 minutos
const TREND_CRON   = "0 3 * * *"     // nightly 03:00 para premium trends
const BATCH_SIZE   = 50              // watches em paralelo por ciclo

export function startScheduler() {
  cron.schedule(POLL_CRON, pollAllWatches, {
    timezone: "UTC",
  })

  cron.schedule(TREND_CRON, aggregateTrends, {
    timezone: "UTC",
  })

  console.log("[Scheduler] Poller iniciado — ciclo de 2 min.")
}

// ─── Ciclo principal ──────────────────────────────────────────────────────────

export async function pollAllWatches() {
  const startedAt = Date.now()

  // Só monitora voos futuros
  const watches = await prisma.watch.findMany({
    where: {
      isActive: true,
      departureDate: { gt: new Date() },
    },
    include: {
      user: { select: { fcmToken: true } },
      snapshots: {
        orderBy: { checkedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "asc" },
  })

  if (watches.length === 0) return

  // Processa em batches para não explodir memória
  let processed = 0
  for (let i = 0; i < watches.length; i += BATCH_SIZE) {
    const batch = watches.slice(i, i + BATCH_SIZE)

    const results = await Promise.allSettled(
      batch.map((watch) => checkPrice(watch, { useCache: true, getPriceCached }))
    )

    const errors = results.filter((r) => r.status === "rejected")
    if (errors.length > 0) {
      errors.forEach((e) => {
        console.error("[Poller] Erro em watch:", (e as PromiseRejectedResult).reason)
      })
    }

    processed += batch.length
  }

  const elapsed = Date.now() - startedAt
  console.log(`[Poller] Ciclo completo — ${processed} watches em ${elapsed}ms`)
}

// ─── Aggregação noturna (premium) ─────────────────────────────────────────────

async function aggregateTrends() {
  const { aggregateRouteTrends } = await import("../services/priceEngine")
  console.log("[Poller] Iniciando aggregação de tendências mensais...")
  await aggregateRouteTrends()
  console.log("[Poller] Tendências atualizadas.")
}

// ─── Trigger manual (admin / testes) ─────────────────────────────────────────

export async function pollSingleWatch(watchId: string) {
  const watch = await prisma.watch.findUnique({
    where: { id: watchId },
    include: {
      user: { select: { fcmToken: true } },
      snapshots: { orderBy: { checkedAt: "desc" }, take: 1 },
    },
  })
  if (!watch) throw new Error(`Watch ${watchId} não encontrado`)

  // Forçar sem cache para trigger manual
  await checkPrice(watch, { useCache: false, getPriceCached })
}
