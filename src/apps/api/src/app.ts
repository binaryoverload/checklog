import express from "express"
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

  // TODO: mount the Better Auth handler at /api/auth here, before express.json() (auth is written by a person, see AGENTS.md)

  app.use(express.json())

  const api = express.Router()
  app.use("/api", api)

  return app
}
