import { toNodeHandler } from "better-auth/node"
import cors from "cors"
import express from "express"

import { auth } from "./auth.ts"
import { config } from "./config.ts"
import { pool } from "./db/index.ts"

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

  app.use(cors({
    origin: config.publicUrl,
    credentials: true,
  }))

  app.all("/api/auth/*splat", toNodeHandler(auth))

  app.use(express.json())

  const api = express.Router()
  app.use("/api", api)

  return app
}
