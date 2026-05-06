import Fastify from "fastify"
import cors from "@fastify/cors"
import jwt from "@fastify/jwt"
import { prisma } from "./db/prisma"
import { authRoutes } from "./routes/auth"
import { watchRoutes } from "./routes/watches"
import { priceRoutes } from "./routes/prices"
import { notificationRoutes } from "./routes/notifications"
import { startScheduler } from "./scheduler/pricePoller"

const server = Fastify({ logger: true })

// ─── Plugins ──────────────────────────────────────────────────────────────────

await server.register(cors, {
  origin: ["chrome-extension://YOUR_EXTENSION_ID"],
  credentials: true,
})

await server.register(jwt, {
  secret: process.env.JWT_SECRET!,
  sign: { expiresIn: "30d" },
})

// ─── Auth decorator ───────────────────────────────────────────────────────────

server.decorate("authenticate", async (request: any, reply: any) => {
  try {
    await request.jwtVerify()
  } catch {
    reply.code(401).send({ error: "Unauthorized" })
  }
})

// ─── Routes ───────────────────────────────────────────────────────────────────

await server.register(authRoutes, { prefix: "/v1/auth" })
await server.register(watchRoutes, { prefix: "/v1/watches" })
await server.register(priceRoutes, { prefix: "/v1/prices" })
await server.register(notificationRoutes, { prefix: "/v1/notifications" })

server.get("/health", () => ({ status: "ok", ts: new Date().toISOString() }))

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  await server.listen({ port: Number(process.env.PORT ?? 3001), host: "0.0.0.0" })
  startScheduler()
  server.log.info("Server running, scheduler started.")
} catch (err) {
  server.log.error(err)
  await prisma.$disconnect()
  process.exit(1)
}
