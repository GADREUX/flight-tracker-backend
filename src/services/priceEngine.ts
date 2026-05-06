/**
 * Price Engine
 *
 * Orquestra a verificação de preço para um watch:
 *   1. Busca preço via API de voos (com cache Redis)
 *   2. Salva snapshot
 *   3. Compara com snapshot anterior
 *   4. Se threshold atingido → tenta obter URL direta da companhia
 *      via booking_token, grava alerta, dispara FCM imediatamente
 */

import { prisma } from "../db/prisma"
import { sendPushNotification } from "./notificationService"
import {
  fetchFlightPrice,
  fetchDirectAirlineUrl,
  type FetchPriceParams,
} from "./searchApiService"
// Para trocar de provedor, substituir a linha acima por:
//   from "./travelpayoutsService"
//   from "./serpApiService"
//   from "./skyScrapperService"
//   from "./duffelService"
//   from "./amadeusService"
// Nota: fetchDirectAirlineUrl só existe no searchApiService.
// Os outros providers não têm essa função — o deepLink vem do deepLinkBuilder.

import { getPriceCached } from "../cache/priceCache"
import type { Watch, PriceSnapshot, User } from "@prisma/client"

type WatchWithContext = Watch & {
  user: Pick<User, "fcmToken">
  snapshots: PriceSnapshot[]
}

interface CheckOptions {
  useCache: boolean
  getPriceCached: typeof getPriceCached
}

export async function checkPrice(
  watch: WatchWithContext,
  options: CheckOptions = { useCache: true, getPriceCached }
) {
  const fetchParams: FetchPriceParams = {
    origin:        watch.origin,
    destination:   watch.destination,
    departureDate: watch.departureDate,
    returnDate:    watch.returnDate ?? undefined,
    adults:        watch.adults,
    cabinClass:    watch.cabinClass,
    currency:      watch.currency,
  }

  const result = options.useCache
    ? await options.getPriceCached(fetchParams, fetchFlightPrice)
    : await fetchFlightPrice(fetchParams)

  if (!result) return

  const { price, currency, airline, priceLevel } = result
  let { deepLink } = result

  // Salva snapshot
  await prisma.priceSnapshot.create({
    data: {
      watchId:  watch.id,
      price,
      currency,
      airline,
      source:   "searchapi",
    },
  })

  // Primeiro snapshot — baseline, sem alerta
  const prev = watch.snapshots[0]
  if (!prev) return

  const oldPrice      = prev.price
  const changePercent = ((price - oldPrice) / oldPrice) * 100
  const absDiff       = Math.abs(changePercent)

  if (absDiff < watch.thresholdPercent) return

  const direction: "DROP" | "RISE" = changePercent < 0 ? "DROP" : "RISE"
  if (direction === "RISE" && !watch.alertOnRise) return

  // Preço mudou além do threshold — tenta obter URL direta da companhia
  // (usa booking_token se disponível, otherwise deepLinkBuilder já está no result)
  if (result.bookingToken) {
    const directUrl = await fetchDirectAirlineUrl(result.bookingToken).catch(() => null)
    if (directUrl) deepLink = directUrl
  }

  // Grava alerta
  await prisma.priceAlert.create({
    data: {
      watchId:       watch.id,
      oldPrice,
      newPrice:      price,
      changePercent: absDiff,
      direction,
      currency,
    },
  })

  // Dispara FCM imediatamente
  if (watch.user.fcmToken) {
    await sendPushNotification({
      token: watch.user.fcmToken,
      title: `${direction === "DROP" ? "📉" : "📈"} ${watch.origin} → ${watch.destination}`,
      body:  buildAlertBody(direction, absDiff, oldPrice, price, currency, watch.departureDate),
      data: {
        type:          "PRICE_ALERT",
        watchId:       watch.id,
        origin:        watch.origin,
        destination:   watch.destination,
        departureDate: watch.departureDate.toISOString(),
        oldPrice:      String(oldPrice),
        newPrice:      String(price),
        direction,
        changePercent: String(absDiff.toFixed(2)),
        currency,
        deepLink,
        priceLevel:    priceLevel ?? "",
      },
    })

    await prisma.priceAlert.updateMany({
      where: { watchId: watch.id, notified: false },
      data:  { notified: true, notifiedAt: new Date() },
    })
  }
}

// ─── Aggregação mensal (premium) ──────────────────────────────────────────────

export async function aggregateRouteTrends() {
  const now   = new Date()
  const month = now.getMonth() + 1
  const year  = now.getFullYear()

  const aggs = await prisma.priceSnapshot.groupBy({
    by: ["watchId"],
    where: {
      checkedAt: {
        gte: new Date(year, month - 1, 1),
        lt:  new Date(year, month, 1),
      },
    },
    _avg:   { price: true },
    _min:   { price: true },
    _max:   { price: true },
    _count: { price: true },
  })

  for (const agg of aggs) {
    const w = await prisma.watch.findUnique({
      where:  { id: agg.watchId },
      select: { origin: true, destination: true, cabinClass: true, currency: true },
    })
    if (!w) continue

    await prisma.routeTrend.upsert({
      where: {
        origin_destination_cabinClass_month_year_currency: {
          origin: w.origin, destination: w.destination,
          cabinClass: w.cabinClass, month, year, currency: w.currency,
        },
      },
      create: {
        origin: w.origin, destination: w.destination, cabinClass: w.cabinClass,
        month, year, currency: w.currency,
        avgPrice:    agg._avg.price ?? 0,
        minPrice:    agg._min.price ?? 0,
        maxPrice:    agg._max.price ?? 0,
        sampleCount: agg._count.price,
      },
      update: {
        avgPrice:    agg._avg.price ?? 0,
        minPrice:    agg._min.price ?? 0,
        maxPrice:    agg._max.price ?? 0,
        sampleCount: agg._count.price,
      },
    })
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function buildAlertBody(
  direction: "DROP" | "RISE",
  pct: number,
  oldPrice: number,
  newPrice: number,
  currency: string,
  departureDate: Date
): string {
  const sign = direction === "DROP" ? "−" : "+"
  const verb = direction === "DROP" ? "caiu" : "subiu"
  const fmt  = (n: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n)
  const date = departureDate.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric",
  })
  return `Preço ${verb} ${sign}${pct.toFixed(1)}% · ${fmt(oldPrice)} → ${fmt(newPrice)} · Partida ${date}`
}
