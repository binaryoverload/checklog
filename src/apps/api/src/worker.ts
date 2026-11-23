import { createBoss } from "@/core/boss.ts"
import { logger } from "@/core/logger.ts"
import { registerScheduleJobs } from "@/jobs/schedules.ts"

// pg-boss workers run from the API image as their own Kubernetes deployment
const boss = createBoss("worker")

logger.info("Starting pg-boss")
await boss.start()
logger.info("Worker started")

await registerScheduleJobs(boss)

// TODO: register job handlers here

async function shutdown(signal: string) {
  logger.info(`${signal} received, stopping worker`)
  // Let in-flight jobs finish before exiting
  await boss.stop({ graceful: true })
  process.exit(0)
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
