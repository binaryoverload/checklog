import { toNodeHandler } from "better-auth/node"
import cors from "cors"
import express from "express"

import { auth } from "./core/auth.ts"
import { config } from "./core/config.ts"
import { pool } from "./db/index.ts"
import { errorHandler, notFound } from "./http/error-handling.ts"
import { requestLogging } from "./http/request-logging.ts"
import { apiRouter } from "./routes/index.ts"

export function createApp() {
  const app = express()

  app.disable("x-powered-by")

  // Kubernetes probes hit the pod directly, outside the /api prefix
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" })
  })

  app.get("/readyz", async (_req, res) => {
    try {
      await pool.query("select 1")
      res.json({ status: "ready" })
    } catch {
      res.status(503).json({ status: "unavailable" })
    }
  })

  // After the probes, so they don't fill the logs
  app.use(requestLogging)

  app.use(cors({
    origin: config.PUBLIC_URL,
    credentials: true,
  }))

  app.all("/api/auth/*splat", toNodeHandler(auth))

  app.use(express.json())

  app.use(apiRouter())

  // Last, so they catch whatever the routes above didn't handle
  app.use(notFound)
  app.use(errorHandler)

  return app
}
