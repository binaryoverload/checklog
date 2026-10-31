import { createApp } from "./app.ts"
import { pool } from "./db/index.ts"
import { env } from "./env.ts"

// TODO: when env.migrateOnStart is set, run the migration function under a Postgres advisory lock before listening

const app = createApp()

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`)
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
