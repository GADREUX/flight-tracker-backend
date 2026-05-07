import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { prisma } from "../db/prisma"

const LoginSchema = z.object({
  googleToken: z.string().min(1),
})

function normalizeGoogleToken(token: string) {
  return token.trim().replace(/^Bearer\s+/i, "")
}

function googleTokenInfoUrl(token: string) {
  const params = new URLSearchParams()
  const tokenParam = token.split(".").length === 3 ? "id_token" : "access_token"
  params.set(tokenParam, token)
  return `https://oauth2.googleapis.com/tokeninfo?${params.toString()}`
}

export async function authRoutes(server: FastifyInstance) {
  server.post("/google", async (request, reply) => {
    const { googleToken: rawGoogleToken } = LoginSchema.parse(request.body)
    const googleToken = normalizeGoogleToken(rawGoogleToken)

    const googleRes = await fetch(googleTokenInfoUrl(googleToken))

    if (!googleRes.ok) {
      return reply.code(401).send({
        error:
          "Google token was rejected. Use a fresh access_token from OAuth Playground with userinfo.email and userinfo.profile scopes.",
      })
    }

    const googleData = await googleRes.json()
    const { sub: googleId, email, name } = googleData

    if (!googleId || !email) {
      return reply.code(401).send({
        error:
          "Google token is valid, but it did not include email/profile data. Re-authorize with userinfo.email and userinfo.profile scopes.",
      })
    }

    const user = await prisma.user.upsert({
      where: { googleId },
      create: { googleId, email, name },
      update: { email, name },
    })

    const authToken = server.jwt.sign(
      { sub: user.id, email: user.email },
      { expiresIn: "30d" }
    )

    await prisma.session.create({
      data: {
        userId: user.id,
        token: authToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    return {
      userId: user.id,
      authToken,
      isPremium: user.isPremium,
    }
  })

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
