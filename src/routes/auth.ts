import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { prisma } from "../db/prisma"

const LoginSchema = z.object({
  googleToken: z.string().min(1),
})

export async function authRoutes(server: FastifyInstance) {
  // POST /v1/auth/google
  server.post("/google", async (request, reply) => {
    const { googleToken } = LoginSchema.parse(request.body)

    // Valida token com Google
    const googleRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${googleToken}`
    )

    if (!googleRes.ok) {
      return reply.code(401).send({ error: "Token Google inválido" })
    }

    const googleData = await googleRes.json()
    const { sub: googleId, email, name } = googleData

    if (!googleId || !email) {
      return reply.code(401).send({ error: "Dados insuficientes do Google" })
    }

    // Upsert do usuário
    const user = await prisma.user.upsert({
      where:  { googleId },
      create: { googleId, email, name },
      update: { email, name },
    })

    // Gera JWT
    const authToken = server.jwt.sign(
      { sub: user.id, email: user.email },
      { expiresIn: "30d" }
    )

    // Salva sessão
    await prisma.session.create({
      data: {
        userId:    user.id,
        token:     authToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    return {
      userId:    user.id,
      authToken,
      isPremium: user.isPremium,
    }
  })

  // POST /v1/auth/logout
  server.post(
    "/logout",
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      const token = request.headers.authorization?.replace("Bearer ", "")
      if (token) {
        await prisma.session.deleteMany({ where: { token } })
      }
      reply.code(204).send()
    }
  )
}
