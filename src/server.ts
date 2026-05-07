import Fastify from "fastify"
import cors from "@fastify/cors"
import jwt from "@fastify/jwt"
import { prisma } from "./db/prisma"
import { authRoutes } from "./routes/auth"
import { watchRoutes } from "./routes/watches"
import { priceRoutes } from "./routes/prices"
import { notificationRoutes } from "./routes/notifications"
import { startScheduler } from "./scheduler/pricePoller"
import { clientPageHtml } from "./clientPage"

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

async function buildServer() {
  const server = Fastify({ logger: true })
  const jwtSecret = requireEnv("JWT_SECRET")
  requireEnv("DATABASE_URL")

  await server.register(cors, {
    origin: ["chrome-extension://YOUR_EXTENSION_ID"],
    credentials: true,
  })

  await server.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: "30d" },
  })

  server.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify()
    } catch {
      reply.code(401).send({ error: "Unauthorized" })
    }
  })

  await server.register(authRoutes, { prefix: "/v1/auth" })
  await server.register(watchRoutes, { prefix: "/v1/watches" })
  await server.register(priceRoutes, { prefix: "/v1/prices" })
  await server.register(notificationRoutes, { prefix: "/v1/notifications" })

  server.get("/", async (_, reply) => {
    reply.type("text/html; charset=utf-8").send(clientPageHtml)
  })

  server.get("/health", () => ({ status: "ok", ts: new Date().toISOString() }))

  return server
}

async function main() {
  let server

  try {
    server = await buildServer()
    await prisma.$connect()
    await server.listen({ port: Number(process.env.PORT ?? 3001), host: "0.0.0.0" })
    startScheduler()
    server.log.info("Server running, scheduler started.")
  } catch (err) {
    if (server) {
      server.log.error(err)
    } else {
      console.error("[Startup] Failed to boot server:", err)
    }
    await prisma.$disconnect().catch(() => {})
    process.exit(1)
  }
}

await main()
