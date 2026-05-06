import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { prisma } from "../db/prisma"

const TokenSchema = z.object({
  token: z.string().min(1),
})

export async function notificationRoutes(server: FastifyInstance) {
  // POST /v1/notifications/fcm-token — registra ou atualiza token GCM da extensão
  server.post(
    "/fcm-token",
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      const { sub: userId } = request.user as { sub: string }
      const { token } = TokenSchema.parse(request.body)

      await prisma.user.update({
        where: { id: userId },
        data:  { fcmToken: token },
      })

      reply.code(204).send()
    }
  )

  // DELETE /v1/notifications/fcm-token — remove token (logout / desinstalar extensão)
  server.delete(
    "/fcm-token",
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      const { sub: userId } = request.user as { sub: string }

      await prisma.user.update({
        where: { id: userId },
        data:  { fcmToken: null },
      })

      reply.code(204).send()
    }
  )
}
