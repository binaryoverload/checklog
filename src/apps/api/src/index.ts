import { config } from "@/core/config.ts"
import { logger } from "@/core/logger.ts"
import { boss } from "@/core/queue.ts"
import { pool, migrateDB } from "@/db/index.ts"
import { pgBossDashboard } from "@/http/pg-boss-dashboard.ts"

import { createApp } from "./app.ts"

const app = createApp()

if (config.MIGRATE_ON_START) {
  await migrateDB()
}

logger.info("Starting pg-boss")
await boss.start()

const server = app.listen(config.PORT, (error) => {
  if (error) throw error
  logger.info(`API listening on http://localhost:${config.PORT}`)
})

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`)
  server.close(async () => {
    await pool.end()
    await boss.stop()
    await pgBossDashboard.close()
    process.exit(0)
  })
  // Force exit if open connections do not drain in time
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
