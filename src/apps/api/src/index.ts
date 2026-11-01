import { createApp } from "./app.ts"
import { config } from "./core/config.ts"
import { logger } from "./core/logger.ts"
import { pool, migrateDB } from "./db/index.ts"

const app = createApp()

if (config.MIGRATE_ON_START) {
  logger.info("Running database migrations")
  await migrateDB()
}

const server = app.listen(config.PORT, (error) => {
  if (error) throw error
  logger.info(`API listening on http://localhost:${config.PORT}`)
})

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`)
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
  // Force exit if open connections do not drain in time
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
