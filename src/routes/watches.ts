import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { prisma } from "../db/prisma"

const CreateWatchSchema = z.object({
  origin: z.string().length(3).toUpperCase(),
  destination: z.string().length(3).toUpperCase(),
  departureDate: z.string().datetime({ offset: true }),
  returnDate: z.string().datetime({ offset: true }).optional(),
  adults: z.number().int().min(1).max(9).default(1),
  cabinClass: z.enum(["ECONOMY", "BUSINESS", "FIRST"]).default("ECONOMY"),
  thresholdPercent: z.number().min(1).max(50).default(10),
  alertOnRise: z.boolean().default(false),
  currency: z.string().length(3).default("BRL"),
})

const FREE_WATCH_LIMIT = 3

export async function watchRoutes(server: FastifyInstance) {
  // GET /v1/watches — list user's active watches
  server.get(
    "/",
    { onRequest: [server.authenticate] },
    async (request) => {
      const { sub: userId } = request.user as { sub: string }

      const watches = await prisma.watch.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: "desc" },
        include: {
          snapshots: {
            orderBy: { checkedAt: "desc" },
            take: 1,
          },
        },
      })

      return watches.map((w) => ({
        id: w.id,
        origin: w.origin,
        destination: w.destination,
        departureDate: w.departureDate.toISOString(),
        returnDate: w.returnDate?.toISOString(),
        adults: w.adults,
        cabinClass: w.cabinClass.toLowerCase(),
        thresholdPercent: w.thresholdPercent,
        alertOnRise: w.alertOnRise,
        currency: w.currency,
        currentPrice: w.snapshots[0]?.price ?? null,
        createdAt: w.createdAt.toISOString(),
      }))
    }
  )

  // POST /v1/watches — create a new watch
  server.post(
    "/",
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      const { sub: userId } = request.user as { sub: string }
      const body = CreateWatchSchema.parse(request.body)

      // Free plan limit check
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user) return reply.code(404).send({ error: "User not found" })

      if (!user.isPremium) {
        const count = await prisma.watch.count({ where: { userId, isActive: true } })
        if (count >= FREE_WATCH_LIMIT) {
          return reply.code(403).send({
            error: `Free plan allows up to ${FREE_WATCH_LIMIT} watches. Upgrade to premium for unlimited.`,
          })
        }
      }

      const watch = await prisma.watch.create({
        data: {
          userId,
          origin: body.origin,
          destination: body.destination,
          departureDate: new Date(body.departureDate),
          returnDate: body.returnDate ? new Date(body.returnDate) : undefined,
          adults: body.adults,
          cabinClass: body.cabinClass,
          thresholdPercent: body.thresholdPercent,
          alertOnRise: body.alertOnRise,
          currency: body.currency,
        },
      })

      reply.code(201)
      return {
        id: watch.id,
        origin: watch.origin,
        destination: watch.destination,
        departureDate: watch.departureDate.toISOString(),
        adults: watch.adults,
        cabinClass: watch.cabinClass.toLowerCase(),
        thresholdPercent: watch.thresholdPercent,
        alertOnRise: watch.alertOnRise,
        currency: watch.currency,
        currentPrice: null,
        createdAt: watch.createdAt.toISOString(),
      }
    }
  )

  // DELETE /v1/watches/:id — soft-delete
  server.delete(
    "/:id",
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      const { sub: userId } = request.user as { sub: string }
      const { id } = request.params as { id: string }

      const watch = await prisma.watch.findFirst({ where: { id, userId } })
      if (!watch) return reply.code(404).send({ error: "Watch not found" })

      await prisma.watch.update({
        where: { id },
        data: { isActive: false },
      })

      reply.code(204).send()
    }
  )
}
