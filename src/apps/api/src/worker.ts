import { and, eq, lt, lte } from "drizzle-orm"
import type { Queue, QueueOptions } from "pg-boss"
import { RRuleTemporal } from "rrule-temporal"

import { bossDb, createBoss } from "@/core/boss.ts"
import { logger } from "@/core/logger.ts"
import { db } from "@/db/index.ts"
import { schedules } from "@/db/schema.ts"

// pg-boss workers run from the API image as their own Kubernetes deployment
const boss = createBoss("worker")

logger.info("Starting pg-boss")
await boss.start()
logger.info("Worker started")

async function ensureQueue(name: string, { policy, ...options }: Omit<Queue, "name">) {
  logger.info(`Ensuring queue ${name}`)
  await boss.createQueue(name, { policy, ...options })
  if (Object.keys(options).length) await boss.updateQueue(name, options)
}

await ensureQueue("create-schedule-jobs", {
  policy: "stately",
  retryLimit: 0,
  expireInSeconds: 50,
})
await ensureQueue("schedule-run-dead", { warningQueueSize: 1 })
await ensureQueue("schedule-run", {
  policy: "standard",
  deadLetter: "schedule-run-dead",
  retryLimit: 3,
  retryBackoff: true,
})

logger.info("Registering schedule create-schedule-jobs")
await boss.schedule("create-schedule-jobs", "* * * * *")

await boss.work("create-schedule-jobs", async () => {
  try {
    const scheduleIds = await db.transaction(async (tx) => {
      const schedulesToSchedule = await tx.select().from(schedules)
        .where(and(
          eq(schedules.status, "active"),
          lte(schedules.nextRunAt, new Date()),
        ))
        .for("update", { skipLocked: true })

      for (const schedule of schedulesToSchedule) {
        await boss.send({
          name: "schedule-run",
          data: {
            scheduleId: schedule.id,
            occurrence: schedule.nextRunAt!.toISOString(),
          },
          options: {
            db: bossDb(tx),
          },
        })
        const next = new RRuleTemporal({ rruleString: schedule.rrule }).next(new Date())
        const nextRunAt = next ? new Date(next.epochMilliseconds) : null
        await tx.update(schedules).set({ nextRunAt }).where(eq(schedules.id, schedule.id))
      }

      return schedulesToSchedule.map(s => s.id)
    })
    if (scheduleIds.length) logger.info("Queued scheduled runs", { scheduleIds })
    return { scheduleIds }
  } catch (err) {
    logger.error("Failed to create schedule jobs", err)
    throw err
  }
})

// TODO: register job handlers here

async function shutdown(signal: string) {
  logger.info(`${signal} received, stopping worker`)
  // Let in-flight jobs finish before exiting
  await boss.stop({ graceful: true })
  process.exit(0)
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
