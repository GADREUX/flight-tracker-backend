import type { FastifyInstance } from "fastify"
import { prisma } from "../db/prisma"
import { pollSingleWatch } from "../scheduler/pricePoller"
import { fetchRouteInsights } from "../services/searchApiService"

export async function priceRoutes(server: FastifyInstance) {
  // GET /v1/prices/:watchId/current — preço atual (último snapshot)
  server.get(
    "/:watchId/current",
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      const { sub: userId } = request.user as { sub: string }
      const { watchId } = request.params as { watchId: string }

      const watch = await prisma.watch.findFirst({ where: { id: watchId, userId } })
      if (!watch) return reply.code(404).send({ error: "Watch não encontrado" })

      const snapshot = await prisma.priceSnapshot.findFirst({
        where:   { watchId },
        orderBy: { checkedAt: "desc" },
      })

      if (!snapshot) return reply.code(404).send({ error: "Sem dados de preço ainda" })

      return {
        price:     snapshot.price,
        currency:  snapshot.currency,
        checkedAt: snapshot.checkedAt.toISOString(),
      }
    }
  )

  // GET /v1/prices/:watchId/history — histórico de snapshots
  server.get(
    "/:watchId/history",
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      const { sub: userId } = request.user as { sub: string }
      const { watchId } = request.params as { watchId: string }

      const watch = await prisma.watch.findFirst({ where: { id: watchId, userId } })
      if (!watch) return reply.code(404).send({ error: "Watch não encontrado" })

      const snapshots = await prisma.priceSnapshot.findMany({
        where:   { watchId },
        orderBy: { checkedAt: "asc" },
        take:    90,  // máximo 90 dias de histórico
      })

      return snapshots.map((s) => ({
        price:     s.price,
        currency:  s.currency,
        checkedAt: s.checkedAt.toISOString(),
      }))
    }
  )

  // POST /v1/prices/:watchId/check — força verificação imediata (premium)
  server.post(
    "/:watchId/check",
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      const { sub: userId } = request.user as { sub: string }
      const { watchId } = request.params as { watchId: string }

      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user?.isPremium) {
        return reply.code(403).send({ error: "Recurso exclusivo do plano premium" })
      }

      const watch = await prisma.watch.findFirst({ where: { id: watchId, userId } })
      if (!watch) return reply.code(404).send({ error: "Watch não encontrado" })

      await pollSingleWatch(watchId)
      reply.code(204).send()
    }
  )

  // GET /v1/prices/:watchId/insights — tendências premium (price_insights)
  server.get(
    "/:watchId/insights",
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      const { sub: userId } = request.user as { sub: string }
      const { watchId } = request.params as { watchId: string }

      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user?.isPremium) {
        return reply.code(403).send({ error: "Recurso exclusivo do plano premium" })
      }

      const watch = await prisma.watch.findFirst({ where: { id: watchId, userId } })
      if (!watch) return reply.code(404).send({ error: "Watch não encontrado" })

      const insights = await fetchRouteInsights({
        origin:        watch.origin,
        destination:   watch.destination,
        departureDate: watch.departureDate,
        returnDate:    watch.returnDate ?? undefined,
        adults:        watch.adults,
        cabinClass:    watch.cabinClass,
        currency:      watch.currency,
      })

      if (!insights) return reply.code(404).send({ error: "Insights não disponíveis" })

      return insights
    }
  )
}
