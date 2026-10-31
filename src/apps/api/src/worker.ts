import { PgBoss } from "pg-boss"
import { config } from "./config.ts"

// pg-boss workers run from the API image as their own Kubernetes deployment
const boss = new PgBoss(config.databaseUrl)

boss.on("error", (error) => {
  console.error("pg-boss error", error)
})

await boss.start()
console.log("Worker started")

// TODO: register job handlers here

async function shutdown(signal: string) {
  console.log(`${signal} received, stopping worker`)
  // Let in-flight jobs finish before exiting
  await boss.stop({ graceful: true })
  process.exit(0)
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
