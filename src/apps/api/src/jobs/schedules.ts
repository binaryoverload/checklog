import { and, eq, lte } from "drizzle-orm"
import type { PgBoss } from "pg-boss"
import { RRuleTemporal } from "rrule-temporal"
import { Temporal } from "temporal-polyfill"

import { bossDb } from "@/core/boss.ts"
import { logger } from "@/core/logger.ts"
import { db } from "@/db/index.ts"
import { runs, schedules, templates } from "@/db/schema.ts"
import { ensureQueue } from "@/jobs/queues.ts"
import { runStartIssues, startRun } from "@/services/runs.ts"
import { systemScheduleActor } from "@checklog/shared/auth"
import { getValidTimezone } from "@checklog/shared/utils"

export interface ScheduleRunData {
  scheduleId: string
  occurrence: string
}

// The minute tick: queues a schedule-run job for each due schedule and moves it on to its next run
export async function queueDueSchedules(boss: PgBoss) {
  try {
    const scheduleIds = await db.transaction(async (tx) => {
      const now = new Date()

      const schedulesToSchedule = await tx.select().from(schedules)
        .where(and(
          eq(schedules.status, "active"),
          lte(schedules.nextRunAt, now),
        ))
        .for("update", { skipLocked: true })

      const queued: string[] = []
      for (const schedule of schedulesToSchedule) {
        let occurrence: Date, nextRunAt: Date | null
        try {
          const rule = new RRuleTemporal({ rruleString: schedule.rrule })

          // We get the latest occurrence so that downtime only triggers the latest missed run
          const latest = rule.previous(now, true)
          occurrence = latest ? new Date(latest.epochMilliseconds) : schedule.nextRunAt!

          const next = rule.next(now)
          nextRunAt = next ? new Date(next.epochMilliseconds) : null
        } catch (error) {
          logger.error("Couldn't work out a schedule's next run", {
            scheduleId: schedule.id,
            error: error instanceof Error ? error.stack : String(error),
          })
          continue
        }

        await boss.send({
          name: "schedule-run",
          data: {
            scheduleId: schedule.id,
            occurrence: occurrence.toISOString(),
          },
          options: {
            db: bossDb(tx),
          },
        })

        await tx.update(schedules).set({ nextRunAt }).where(eq(schedules.id, schedule.id))
        queued.push(schedule.id)
      }

      return queued
    })
    if (scheduleIds.length) logger.info("Queued scheduled runs", { scheduleIds })
    return { scheduleIds }
  } catch (err) {
    logger.error("Failed to create schedule jobs", err)
    throw err
  }
}

// Starts the run for one schedule's occurrence, or says why it was skipped
export async function startScheduledRun(data: ScheduleRunData) {
  const result = await db.transaction(async (tx) => {
    const { scheduleId, occurrence } = data

    const [schedule] = await tx.select().from(schedules).where(eq(schedules.id, scheduleId)).for("share")
    if (!schedule) return { status: "skipped", reason: "not_found" }
    if (schedule.status !== "active") return { status: "skipped", reason: schedule.status }

    const [existingRun] = await tx.select().from(runs).where(and(
      eq(runs.scheduleId, scheduleId),
      eq(runs.scheduledFor, new Date(occurrence)),
    ))
    if (existingRun) return { status: "already_started", runId: existingRun.id }

    const [template] = await tx.select().from(templates).where(eq(templates.id, schedule.templateId))
    if (!template) {
      logger.error("Template not found", { templateId: schedule.templateId })
      return {
        status: "skipped",
        reason: "template_not_found",
      }
    }

    const runIssues = await runStartIssues(tx, template)
    if (runIssues.length) {
      logger.warn("Run issues found", { templateId: template.id, runIssues })
      // TODO: Notify issues to user
      return {
        status: "skipped",
        reason: "issues",
        details: runIssues,
      }
    }

    const at = Temporal.Instant.from(occurrence).toZonedDateTimeISO(schedule.timezone)

    const name = schedule.runNamePattern
      .replaceAll("{template}", template.name)
      .replaceAll("{date}", at.toPlainDate().toString())
      .replaceAll("{time}", at.toPlainTime().toString({ smallestUnit: "minute" }))
      .replaceAll("{week}", String(at.weekOfYear))

    const run = await startRun(tx, {
      template,
      createdBy: systemScheduleActor,
      scheduleId,
      scheduledFor: new Date(occurrence),
      timezone: getValidTimezone(schedule.timezone),
      name,
    })

    logger.info(`Started run ${run.id} from schedule ${scheduleId}`)

    return {
      status: "started",
      runId: run.id,
    }
  })

  return result
}

export async function registerScheduleJobs(boss: PgBoss) {
  await ensureQueue(boss, "create-schedule-jobs", {
    policy: "stately",
    retryLimit: 0,
    expireInSeconds: 50,
  })
  await ensureQueue(boss, "schedule-run-dead", { warningQueueSize: 1 })
  await ensureQueue(boss, "schedule-run", {
    policy: "standard",
    deadLetter: "schedule-run-dead",
    retryLimit: 3,
    retryBackoff: true,
  })

  logger.info("Registering schedule create-schedule-jobs")
  await boss.schedule("create-schedule-jobs", "* * * * *")

  await boss.work("create-schedule-jobs", () => queueDueSchedules(boss))
  await boss.work("schedule-run", async ([job]) => {
    if (!job) return
    return startScheduledRun(job.data as ScheduleRunData)
  })
}
