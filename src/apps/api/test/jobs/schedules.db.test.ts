import { eq } from "drizzle-orm"
import { DateTime } from "luxon"
import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createBoss } from "@/core/boss.ts"
import { db } from "@/db/index.ts"
import { schedules } from "@/db/schema.ts"
import { queueDueSchedules, startScheduledRun } from "@/jobs/schedules.ts"
import type { Organization, Template } from "@/util/types.ts"
import { systemScheduleActor } from "@checklog/shared/auth"
import { createOrganization, insertSchedule, insertTemplate } from "@test/support/database.ts"
import { publishedTemplate, runsOf, stepsOfRun } from "@test/support/runs.ts"

// These tests call the job functions directly, as the worker's handlers do, so no worker is running.
// The tick looks at every organization's schedules, so each test checks only the schedules it made.

let boss: PgBoss

beforeAll(async () => {
  boss = createBoss("api")
  await boss.start()
  await boss.createQueue("schedule-run")
})

afterAll(async () => {
  await boss.stop({ graceful: false })
})

// Every hour on the hour in London, since 2020, so there's always a next run within the hour
const hourly = "DTSTART;TZID=Europe/London:20200101T000000\nRRULE:FREQ=HOURLY"
// Finished: 09:00 on 1, 2 and 3 January 2020, so its last occurrence doesn't depend on when the test runs
const finished = "DTSTART;TZID=Europe/London:20200101T090000\nRRULE:FREQ=DAILY;COUNT=3"
const nextHour = () => DateTime.now().setZone("Europe/London").startOf("hour").plus({ hours: 1 }).toMillis()
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000)

async function storedSchedule(scheduleId: string) {
  const [row] = await db.select().from(schedules).where(eq(schedules.id, scheduleId))
  return row!
}

async function queuedRuns(scheduleId: string) {
  return boss.findJobs<{ scheduleId: string, occurrence: string }>("schedule-run", { data: { scheduleId } })
}

async function templateIn(organization: Organization): Promise<Template> {
  return (await publishedTemplate(organization, [{}, {}])).template
}

describe("queueDueSchedules", () => {
  test("queues a run for a due schedule, for the occurrence it was due at", async () => {
    const template = await templateIn(await createOrganization(db))
    const dueAt = new Date("2020-01-03T09:00:00.000Z")
    const schedule = await insertSchedule(db, template, "active", { rrule: finished, nextRunAt: dueAt })

    const { scheduleIds } = await queueDueSchedules(boss)

    expect(scheduleIds).toContain(schedule.id)
    expect((await queuedRuns(schedule.id)).map(job => job.data)).toEqual([{ scheduleId: schedule.id, occurrence: dueAt.toISOString() }])
  })

  test("moves the schedule on to its next run from now", async () => {
    const template = await templateIn(await createOrganization(db))
    const schedule = await insertSchedule(db, template, "active", { rrule: hourly, nextRunAt: anHourAgo() })

    await queueDueSchedules(boss)

    expect((await storedSchedule(schedule.id)).nextRunAt?.getTime()).toBe(nextHour())
  })

  test("queues one run, not one per missed occurrence, for a schedule that's been due a long time", async () => {
    const template = await templateIn(await createOrganization(db))
    const schedule = await insertSchedule(db, template, "active", { rrule: hourly, nextRunAt: new Date("2026-01-01T00:00:00Z") })

    await queueDueSchedules(boss)

    expect(await queuedRuns(schedule.id)).toHaveLength(1)
    expect((await storedSchedule(schedule.id)).nextRunAt?.getTime()).toBe(nextHour())
  })

  test("uses the most recent missed occurrence, not the first one missed", async () => {
    const template = await templateIn(await createOrganization(db))
    const schedule = await insertSchedule(db, template, "active", { rrule: finished, nextRunAt: new Date("2020-01-01T09:00:00.000Z") })

    await queueDueSchedules(boss)

    expect((await queuedRuns(schedule.id)).map(job => job.data.occurrence)).toEqual(["2020-01-03T09:00:00.000Z"])
  })

  test("clears the next run of a schedule with no occurrences left", async () => {
    const template = await templateIn(await createOrganization(db))
    const schedule = await insertSchedule(db, template, "active", { rrule: finished, nextRunAt: anHourAgo() })

    await queueDueSchedules(boss)

    expect(await queuedRuns(schedule.id)).toHaveLength(1)
    expect((await storedSchedule(schedule.id)).nextRunAt).toBeNull()
  })

  test("leaves a schedule that isn't due yet alone", async () => {
    const template = await templateIn(await createOrganization(db))
    const later = new Date(Date.now() + 60 * 60 * 1000)
    const schedule = await insertSchedule(db, template, "active", { rrule: hourly, nextRunAt: later })

    const { scheduleIds } = await queueDueSchedules(boss)

    expect(scheduleIds).not.toContain(schedule.id)
    expect(await queuedRuns(schedule.id)).toEqual([])
    expect((await storedSchedule(schedule.id)).nextRunAt?.getTime()).toBe(later.getTime())
  })

  test.each(["paused", "archived"] as const)("leaves a %s schedule alone, even with a next run in the past", async (status) => {
    const template = await templateIn(await createOrganization(db))
    const dueAt = anHourAgo()
    const schedule = await insertSchedule(db, template, status, { rrule: hourly, nextRunAt: dueAt })

    const { scheduleIds } = await queueDueSchedules(boss)

    expect(scheduleIds).not.toContain(schedule.id)
    expect(await queuedRuns(schedule.id)).toEqual([])
    expect((await storedSchedule(schedule.id)).nextRunAt?.getTime()).toBe(dueAt.getTime())
  })

  test("leaves an active schedule with no next run alone", async () => {
    const template = await templateIn(await createOrganization(db))
    const schedule = await insertSchedule(db, template, "active", { rrule: hourly, nextRunAt: null })

    const { scheduleIds } = await queueDueSchedules(boss)

    expect(scheduleIds).not.toContain(schedule.id)
    expect(await queuedRuns(schedule.id)).toEqual([])
  })

  test("queues each due schedule once when two ticks run at the same time", async () => {
    const template = await templateIn(await createOrganization(db))
    const schedule = await insertSchedule(db, template, "active", { rrule: hourly, nextRunAt: anHourAgo() })

    await Promise.all([queueDueSchedules(boss), queueDueSchedules(boss)])

    expect(await queuedRuns(schedule.id)).toHaveLength(1)
  })

  test("leaves a schedule whose next run can't be worked out as it was, and still queues the others", async () => {
    const template = await templateIn(await createOrganization(db))
    const dueAt = new Date("2020-01-03T09:00:00.000Z")
    // More occurrences than rrule-temporal will step through, so working out its next run throws
    const unworkable = "DTSTART;TZID=Europe/London:20200101T000000\nRRULE:FREQ=HOURLY;COUNT=100000"
    const before = await insertSchedule(db, template, "active", { rrule: finished, nextRunAt: dueAt })
    const bad = await insertSchedule(db, template, "active", { rrule: unworkable, nextRunAt: dueAt })
    const after = await insertSchedule(db, template, "active", { rrule: finished, nextRunAt: dueAt })

    try {
      const { scheduleIds } = await queueDueSchedules(boss)

      expect(scheduleIds).toEqual(expect.arrayContaining([before.id, after.id]))
      expect(scheduleIds).not.toContain(bad.id)
      expect(await queuedRuns(before.id)).toHaveLength(1)
      expect(await queuedRuns(after.id)).toHaveLength(1)
      expect(await queuedRuns(bad.id)).toEqual([])
      expect((await storedSchedule(bad.id)).nextRunAt).toEqual(dueAt)
    } finally {
      // The tick looks at every schedule, so don't leave this one due for the other tests
      await db.delete(schedules).where(eq(schedules.id, bad.id))
    }
  })
})

describe("startScheduledRun", () => {
  const occurrence = "2026-11-23T09:00:00.000Z"

  test("starts a run of the template's current version for the occurrence, as the scheduler", async () => {
    const { template, version } = await publishedTemplate(await createOrganization(db), [{}, {}])
    const schedule = await insertSchedule(db, template, "active", { timezone: "Europe/London" })

    const result = await startScheduledRun({ scheduleId: schedule.id, occurrence })

    const [run] = await runsOf(template)
    expect(result).toEqual({ status: "started", runId: run!.id })
    expect(run).toMatchObject({
      templateVersionId: version.id,
      scheduleId: schedule.id,
      status: "in_progress",
      timezone: "Europe/London",
      createdBy: systemScheduleActor,
    })
    expect(run!.scheduledFor?.toISOString()).toBe(occurrence)
    expect(await stepsOfRun(run!)).toHaveLength(2)
  })

  test("names the run from the pattern, with the date, time and week in the schedule's time zone", async () => {
    const template = await templateIn(await createOrganization(db))
    const schedule = await insertSchedule(db, template, "active", {
      timezone: "America/New_York",
      runNamePattern: "{template} on {date} at {time}, week {week} ({template})",
    })
    // 02:30 UTC on Monday 30 March is still Sunday 29 March in New York, in ISO week 13
    const lateEvening = "2026-03-30T02:30:00.000Z"

    await startScheduledRun({ scheduleId: schedule.id, occurrence: lateEvening })

    const [run] = await runsOf(template)
    expect(run!.name).toBe(`${template.name} on 2026-03-29 at 22:30, week 13 (${template.name})`)
  })

  test("starts the run only once when the same occurrence is retried", async () => {
    const template = await templateIn(await createOrganization(db))
    const schedule = await insertSchedule(db, template, "active")

    const first = await startScheduledRun({ scheduleId: schedule.id, occurrence })
    const retried = await startScheduledRun({ scheduleId: schedule.id, occurrence })

    const runs = await runsOf(template)
    expect(runs).toHaveLength(1)
    expect(retried).toEqual({ status: "already_started", runId: runs[0]!.id })
    expect(first).toEqual({ status: "started", runId: runs[0]!.id })
  })

  test("starts a separate run for each occurrence", async () => {
    const template = await templateIn(await createOrganization(db))
    const schedule = await insertSchedule(db, template, "active")

    await startScheduledRun({ scheduleId: schedule.id, occurrence: "2026-11-23T09:00:00.000Z" })
    await startScheduledRun({ scheduleId: schedule.id, occurrence: "2026-11-24T09:00:00.000Z" })

    expect((await runsOf(template)).map(run => run.scheduledFor?.toISOString()).sort())
      .toEqual(["2026-11-23T09:00:00.000Z", "2026-11-24T09:00:00.000Z"])
  })

  test.each(["paused", "archived"] as const)("skips a schedule that was %s after its run was queued", async (status) => {
    const template = await templateIn(await createOrganization(db))
    const schedule = await insertSchedule(db, template, status)

    expect(await startScheduledRun({ scheduleId: schedule.id, occurrence })).toEqual({ status: "skipped", reason: status })
    expect(await runsOf(template)).toEqual([])
  })

  test("skips a schedule that no longer exists", async () => {
    expect(await startScheduledRun({ scheduleId: "sched_01m82vkk1afvh995pywrhryypz", occurrence })).toEqual({ status: "skipped", reason: "not_found" })
  })

  test("skips a template that fails the start check, saying why", async () => {
    const organization = await createOrganization(db)
    const template = await insertTemplate(db, organization)
    const schedule = await insertSchedule(db, template, "active")

    const result = await startScheduledRun({ scheduleId: schedule.id, occurrence })

    expect(result).toMatchObject({ status: "skipped", reason: "issues" })
    expect(JSON.stringify(result)).toContain("no_current_version")
    expect(await runsOf(template)).toEqual([])
  })
})
