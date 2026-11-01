import { createApp } from "./app.ts"
import { config } from "./config.ts"
import { pool, migrateDB } from "./db/index.ts"

const app = createApp()

if (config.migrateOnStart) {
  console.log("Running database migrations...")
  await migrateDB()
}

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`)
})

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`)
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
  // Force exit if open connections do not drain in time
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
