import { asc, eq } from "drizzle-orm"
import { DateTime } from "luxon"
import { RRuleTemporal } from "rrule-temporal"
import type request from "supertest"
import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import { schedules } from "@/db/schema.ts"
import type { Organization, Schedule, Template } from "@/util/types.ts"
import type { ScheduleDto } from "@checklog/shared/api"
import type { ScheduleRecurrence, ScheduleStatus } from "@checklog/shared/domain"
import { typeIdForTable } from "@checklog/shared/utils"
import { createOrganization, expectCreationKept, grant, insertSchedule, insertTemplate } from "@test/support/database.ts"
import { api, expectError, expectStatus } from "@test/support/http.ts"
import { publishedTemplate } from "@test/support/runs.ts"
import { signedInMember, stubSessions } from "@test/support/session.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates or schedules.

stubSessions()

const listSchedules = (query: Record<string, string>) => api().get("/api/schedules").query(query)
const createSchedule = (body: object) => api().post("/api/schedules").send(body)
const editSchedule = (scheduleId: string, body: object) => api().patch(`/api/schedules/${scheduleId}`).send(body)
const changeStatus = (scheduleId: string, action: string) => api().post(`/api/schedules/${scheduleId}/${action}`)

// The recurrence insertSchedule's default rule stands for: daily at 09:00 in London, from 1 January 2099
const daily: ScheduleRecurrence = { frequency: "daily", interval: 1, startDate: "2099-01-01", time: "09:00" }
const dailyFirstRun = "2099-01-01T09:00:00.000Z"

const validBody = (templateId: string, overrides: object = {}) => ({ templateId, recurrence: daily, timezone: "Europe/London", runNamePattern: "{template}", ...overrides })

// The instant of a wall-clock date and time in a zone
const instant = (date: string, time: string, zone: string) => DateTime.fromISO(`${date}T${time}`, { zone }).toUTC().toMillis()
const timeOf = (iso: string | null) => (iso === null ? null : new Date(iso).getTime())

async function storedSchedule(scheduleId: string) {
  const [row] = await db.select().from(schedules).where(eq(schedules.id, scheduleId))
  return row
}

async function schedulesOf(template: Template) {
  return db.select().from(schedules).where(eq(schedules.templateId, template.id)).orderBy(asc(schedules.createdAt), asc(schedules.id))
}

// A template with a published version, which the member can edit as the owner
async function templateFor(organization: Organization) {
  return (await publishedTemplate(organization, [{}])).template
}

describe("GET /api/schedules", () => {
  test("lists every schedule of the template, whatever its status", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const active = await insertSchedule(db, template, "active", { nextRunAt: new Date(dailyFirstRun) })
    const paused = await insertSchedule(db, template, "paused")
    const archived = await insertSchedule(db, template, "archived")

    const response = await listSchedules({ templateId: template.id })

    expectStatus(response, 200)
    const body = response.body as ScheduleDto[]
    expect(body.map(schedule => schedule.id).sort()).toEqual([active.id, paused.id, archived.id].sort())
    const returned = body.find(schedule => schedule.id === active.id)!
    expect(returned).toMatchObject({
      templateId: template.id,
      status: "active",
      timezone: "Europe/London",
      runNamePattern: "Weekly checks",
      createdBy: active.createdBy,
      createdAt: active.createdAt.toISOString(),
    })
    expect(returned.recurrence).toMatchObject(daily)
    expect(timeOf(returned.nextRunAt)).toBe(timeOf(dailyFirstRun))
    expect(returned).not.toHaveProperty("organizationId")
    expect(returned).not.toHaveProperty("rrule")
  })

  test("lists only the given template's schedules", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const mine = await insertSchedule(db, template, "active")
    await insertSchedule(db, await templateFor(organization), "active")

    const response = await listSchedules({ templateId: template.id })

    expect((response.body as ScheduleDto[]).map(schedule => schedule.id)).toEqual([mine.id])
  })

  test("returns an empty list for a template with no schedules", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)

    const response = await listSchedules({ templateId: template.id })

    expectStatus(response, 200)
    expect(response.body).toEqual([])
  })

  test("lets a member with view access to the template list its schedules", async () => {
    const { organization, member } = await signedInMember("viewer")
    const template = await templateFor(organization)
    await grant(db, template.id, { organization, memberId: member.id }, "view")
    const schedule = await insertSchedule(db, template, "active")

    expect(((await listSchedules({ templateId: template.id })).body as ScheduleDto[]).map(one => one.id)).toEqual([schedule.id])
  })

  test("refuses a template the member can't see with not_found", async () => {
    const { organization } = await signedInMember("viewer")
    const template = await templateFor(organization)
    await insertSchedule(db, template, "active")

    expectError(await listSchedules({ templateId: template.id }), 404, "not_found")
  })

  test("refuses another organization's template with not_found", async () => {
    const template = await templateFor(await createOrganization(db))
    await insertSchedule(db, template, "active")
    await signedInMember("owner")

    expectError(await listSchedules({ templateId: template.id }), 404, "not_found")
  })

  test("refuses a template ID that doesn't exist with not_found", async () => {
    await signedInMember("owner")

    expectError(await listSchedules({ templateId: typeIdForTable("templates").toString() }), 404, "not_found")
  })

  test.each([
    ["no template ID", {}],
    ["a template ID that isn't a TypeID", { templateId: "not-an-id" }],
    ["a template ID for another table", { templateId: typeIdForTable("runs").toString() }],
  ])("refuses %s with validation_failed", async (_description, query) => {
    await signedInMember("owner")

    expectError(await listSchedules(query), 400, "validation_failed")
  })

  test("refuses a signed-out request with unauthorized", async () => {
    const template = await templateFor(await createOrganization(db))

    expectError(await listSchedules({ templateId: template.id }), 401, "unauthorized")
  })
})

describe("POST /api/schedules", () => {
  test("creates an active schedule from the recurrence, returns it and records who created it", async () => {
    const { organization, member } = await signedInMember("owner")
    const template = await templateFor(organization)

    const response = await createSchedule(validBody(template.id, { runNamePattern: "{template}, week {week}" }))

    expectStatus(response, 200)
    const body = response.body as ScheduleDto
    expect(body).toMatchObject({
      templateId: template.id,
      status: "active",
      timezone: "Europe/London",
      runNamePattern: "{template}, week {week}",
      createdBy: member.userId,
    })
    expect(body.recurrence).toMatchObject(daily)
    expect(timeOf(body.nextRunAt)).toBe(timeOf(dailyFirstRun))
    expect(body).not.toHaveProperty("organizationId")

    const [stored] = await schedulesOf(template)
    expect(stored).toMatchObject({ id: body.id, status: "active", timezone: "Europe/London", createdBy: member.userId })
    expect(stored!.nextRunAt?.getTime()).toBe(timeOf(dailyFirstRun))
  })

  test("stores the recurrence as a standard RFC 5545 rule in the schedule's zone", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)

    expectStatus(await createSchedule(validBody(template.id)), 200)

    const [stored] = await schedulesOf(template)
    const rule = new RRuleTemporal({ rruleString: stored!.rrule }).options()
    expect(rule.freq).toBe("DAILY")
    expect(rule.tzid).toBe("Europe/London")
  })

  test.each<[string, ScheduleRecurrence]>([
    ["weekly on chosen days with an interval and an end date", {
      frequency: "weekly",
      interval: 2,
      weekdays: ["monday", "thursday"],
      startDate: "2099-03-02",
      time: "07:30",
      endDate: "2099-12-31",
    }],
    ["monthly with a count", { frequency: "monthly", interval: 1, count: 6, startDate: "2099-01-15", time: "18:00" }],
    ["yearly in chosen months", { frequency: "yearly", interval: 1, months: [3, 9], startDate: "2099-01-01", time: "12:00" }],
  ])("returns the recurrence it was given: %s", async (_description, recurrence) => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)

    const response = await createSchedule(validBody(template.id, { recurrence }))

    expectStatus(response, 200)
    expect((response.body as ScheduleDto).recurrence).toEqual(recurrence)
  })

  test("fills in an interval of 1 when the recurrence has none", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const response = await createSchedule(validBody(template.id, { recurrence: { ...daily, interval: undefined } }))

    expectStatus(response, 200)
    expect((response.body as ScheduleDto).recurrence.interval).toBe(1)
  })

  test.each([
    ["in London in summer, an hour ahead of UTC", "2099-07-01", "Europe/London"],
    ["in London in winter, on UTC", "2099-01-10", "Europe/London"],
    ["in New York in winter", "2099-01-10", "America/New_York"],
  ])("works out the first run in the schedule's own zone: %s", async (_description, startDate, timezone) => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)

    const response = await createSchedule(validBody(template.id, { recurrence: { ...daily, startDate }, timezone }))

    expect(timeOf((response.body as ScheduleDto).nextRunAt)).toBe(instant(startDate, "09:00", timezone))
  })

  test("starts a weekly schedule on the first chosen weekday on or after the start date", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const start = DateTime.fromISO("2099-01-01", { zone: "Europe/London" })
    const firstMonday = start.plus({ days: (8 - start.weekday) % 7 })

    const response = await createSchedule(validBody(template.id, {
      recurrence: { frequency: "weekly", interval: 1, weekdays: ["monday"], startDate: "2099-01-01", time: "09:00" },
    }))

    expect(timeOf((response.body as ScheduleDto).nextRunAt)).toBe(instant(firstMonday.toISODate()!, "09:00", "Europe/London"))
  })

  test("works out the next run from now for a start date in the past", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const now = DateTime.now().setZone("Europe/London")
    const today = now.set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
    const expected = today > now ? today : today.plus({ days: 1 })

    const response = await createSchedule(validBody(template.id, { recurrence: { ...daily, startDate: "2020-01-01" } }))

    expect(timeOf((response.body as ScheduleDto).nextRunAt)).toBe(expected.toMillis())
  })

  test.each(["hourly", "daily", "weekly", "monthly"] as const)("works out the next run of a %s schedule with the largest count", async (frequency) => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)

    const response = await createSchedule(validBody(template.id, { recurrence: { ...daily, frequency, count: 1000 } }))

    expectStatus(response, 200)
    expect(timeOf((response.body as ScheduleDto).nextRunAt)).toBe(timeOf(dailyFirstRun))
  })

  test("leaves no next run when every occurrence has passed", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)

    const response = await createSchedule(validBody(template.id, { recurrence: { ...daily, startDate: "2020-01-01", count: 3 } }))

    expectStatus(response, 200)
    expect((response.body as ScheduleDto).nextRunAt).toBeNull()
  })

  test("names runs after the template, date and time when no run name pattern is given", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)

    const response = await createSchedule({ ...validBody(template.id), runNamePattern: undefined })

    expectStatus(response, 200)
    expect((response.body as ScheduleDto).runNamePattern).toBe("{template} - {date} {time}")
  })

  test.each([
    "{template}",
    "{template} {date}",
    "{template} at {time}",
    "Week {week} checks",
    "Fridge check",
  ])("accepts the run name pattern %j", async (runNamePattern) => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)

    expectStatus(await createSchedule(validBody(template.id, { runNamePattern })), 200)
  })

  test("stores the time zone in its canonical form", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)

    const response = await createSchedule(validBody(template.id, { timezone: "europe/london" }))

    expect((response.body as ScheduleDto).timezone).toBe("Europe/London")
  })

  test.each([
    ["no recurrence", { recurrence: undefined }],
    ["a recurrence with both a count and an end date", { recurrence: { ...daily, count: 3, endDate: "2099-02-01" } }],
    ["a count over 1000", { recurrence: { ...daily, count: 1001 } }],
    ["a time with seconds", { recurrence: { ...daily, time: "09:00:00" } }],
    ["an unknown frequency", { recurrence: { ...daily, frequency: "fortnightly" } }],
    ["a fixed-offset time zone", { timezone: "+01:00" }],
    ["a time zone that doesn't exist", { timezone: "Europe/Atlantis" }],
    ["no time zone", { timezone: undefined }],
    ["an unknown placeholder in the run name pattern", { runNamePattern: "{template} {wek}" }],
    ["an empty run name pattern", { runNamePattern: "" }],
    ["an unknown key", { status: "paused" }],
  ])("refuses %s with validation_failed and stores nothing", async (_description, overrides) => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)

    expectError(await createSchedule(validBody(template.id, overrides)), 400, "validation_failed")
    expect(await schedulesOf(template)).toEqual([])
  })

  test.each([
    ["no template ID", { templateId: undefined }],
    ["a template ID for another table", { templateId: typeIdForTable("runs").toString() }],
  ])("refuses %s with validation_failed", async (_description, overrides) => {
    await signedInMember("owner")

    expectError(await createSchedule({ ...validBody(""), ...overrides }), 400, "validation_failed")
  })

  test("refuses an archived template with conflict and stores nothing", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization, { status: "archived" })

    expectError(await createSchedule(validBody(template.id)), 409, "conflict")
    expect(await schedulesOf(template)).toEqual([])
  })

  test("lets a member with edit access to the template create a schedule", async () => {
    const { organization, member } = await signedInMember("viewer")
    const template = await templateFor(organization)
    await grant(db, template.id, { organization, memberId: member.id }, "edit")

    expectStatus(await createSchedule(validBody(template.id)), 200)
  })

  test.each(["view", "run"] as const)("refuses a member with %s access with forbidden and stores nothing", async (level) => {
    const { organization, member } = await signedInMember("viewer")
    const template = await templateFor(organization)
    await grant(db, template.id, { organization, memberId: member.id }, level)

    expectError(await createSchedule(validBody(template.id)), 403, "forbidden")
    expect(await schedulesOf(template)).toEqual([])
  })

  test("refuses a template the member can't see with not_found", async () => {
    const { organization } = await signedInMember("viewer")
    const template = await templateFor(organization)

    expectError(await createSchedule(validBody(template.id)), 404, "not_found")
    expect(await schedulesOf(template)).toEqual([])
  })

  test("refuses another organization's template with not_found and stores nothing", async () => {
    const template = await templateFor(await createOrganization(db))
    await signedInMember("owner")

    expectError(await createSchedule(validBody(template.id)), 404, "not_found")
    expect(await schedulesOf(template)).toEqual([])
  })

  test("refuses a signed-out request with unauthorized", async () => {
    const template = await templateFor(await createOrganization(db))

    expectError(await createSchedule(validBody(template.id)), 401, "unauthorized")
  })
})

describe("PATCH /api/schedules/:scheduleId", () => {
  test("changes the recurrence, works out the next run again and returns the schedule", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const schedule = await insertSchedule(db, template, "active", { nextRunAt: new Date(dailyFirstRun) })
    const recurrence: ScheduleRecurrence = { frequency: "daily", interval: 1, startDate: "2099-07-01", time: "06:45" }

    const response = await editSchedule(schedule.id, { recurrence })

    expectStatus(response, 200)
    const body = response.body as ScheduleDto
    expect(body).toMatchObject({ id: schedule.id, status: "active" })
    expect(body.recurrence).toMatchObject(recurrence)
    expect(timeOf(body.nextRunAt)).toBe(instant("2099-07-01", "06:45", "Europe/London"))
    expect((await storedSchedule(schedule.id))!.nextRunAt?.getTime()).toBe(instant("2099-07-01", "06:45", "Europe/London"))
  })

  test("changes only what it's given, working out the next run in a new time zone", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const schedule = await insertSchedule(db, template, "active", { nextRunAt: new Date(dailyFirstRun) })

    const response = await editSchedule(schedule.id, { timezone: "America/New_York" })

    expectStatus(response, 200)
    const body = response.body as ScheduleDto
    expect(body).toMatchObject({ timezone: "America/New_York", runNamePattern: schedule.runNamePattern })
    expect(body.recurrence).toMatchObject(daily)
    expect(timeOf(body.nextRunAt)).toBe(instant("2099-01-01", "09:00", "America/New_York"))
  })

  test("changes the run name pattern", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const schedule = await insertSchedule(db, template, "active")

    const response = await editSchedule(schedule.id, { runNamePattern: "{template}, {date}" })

    expectStatus(response, 200)
    expect((await storedSchedule(schedule.id))!.runNamePattern).toBe("{template}, {date}")
  })

  test("clears the next run when the new recurrence has no occurrences left", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const schedule = await insertSchedule(db, template, "active", { nextRunAt: new Date(dailyFirstRun) })

    const response = await editSchedule(schedule.id, { recurrence: { ...daily, startDate: "2020-01-01", count: 3 } })

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ status: "active", nextRunAt: null })
    expect((await storedSchedule(schedule.id))!.nextRunAt).toBeNull()
  })

  test("keeps a paused schedule paused, with no next run", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const schedule = await insertSchedule(db, template, "paused")

    const response = await editSchedule(schedule.id, { recurrence: { ...daily, time: "10:00" } })

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ status: "paused", nextRunAt: null })
  })

  test("keeps who created the schedule, and when", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const schedule = await insertSchedule(db, template, "active")

    expectStatus(await editSchedule(schedule.id, { runNamePattern: "{template}" }), 200)

    expectCreationKept(schedule, await storedSchedule(schedule.id))
  })

  test("refuses an archived schedule with conflict and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const schedule = await insertSchedule(db, template, "archived")

    expectError(await editSchedule(schedule.id, { runNamePattern: "{template}" }), 409, "conflict")
    expect(await storedSchedule(schedule.id)).toEqual(schedule)
  })

  test.each([
    ["a recurrence with both a count and an end date", { recurrence: { ...daily, count: 3, endDate: "2099-02-01" } }],
    ["a count over 1000", { recurrence: { ...daily, count: 1001 } }],
    ["a fixed-offset time zone", { timezone: "+01:00" }],
    ["an unknown placeholder in the run name pattern", { runNamePattern: "{template} {wek}" }],
    ["a change of template", { templateId: typeIdForTable("templates").toString() }],
    ["a change of status", { status: "paused" }],
  ])("refuses %s with validation_failed and changes nothing", async (_description, body) => {
    const { organization } = await signedInMember("owner")
    const template = await templateFor(organization)
    const schedule = await insertSchedule(db, template, "active")

    expectError(await editSchedule(schedule.id, body), 400, "validation_failed")
    expect(await storedSchedule(schedule.id)).toEqual(schedule)
  })
})

// The status changes, each from the statuses it allows to the status it leaves
const statusChanges: { action: string, from: ScheduleStatus[], refused: ScheduleStatus[], to: ScheduleStatus }[] = [
  { action: "pause", from: ["active"], refused: ["paused", "archived"], to: "paused" },
  { action: "resume", from: ["paused"], refused: ["active", "archived"], to: "active" },
  { action: "archive", from: ["active", "paused"], refused: ["archived"], to: "archived" },
  { action: "restore", from: ["archived"], refused: ["active", "paused"], to: "paused" },
]

for (const change of statusChanges) {
  describe(`POST /api/schedules/:scheduleId/${change.action}`, () => {
    test.each(change.from)(`changes a %s schedule to ${change.to} and returns it`, async (from) => {
      const { organization } = await signedInMember("owner")
      const template = await templateFor(organization)
      const schedule = await insertSchedule(db, template, from, { nextRunAt: from === "active" ? new Date(dailyFirstRun) : null })

      const response = await changeStatus(schedule.id, change.action)

      expectStatus(response, 200)
      expect(response.body).toMatchObject({ id: schedule.id, status: change.to })
      expect((await storedSchedule(schedule.id))!.status).toBe(change.to)
    })

    if (change.to === "active") {
      test("works out the next run", async () => {
        const { organization } = await signedInMember("owner")
        const template = await templateFor(organization)
        const schedule = await insertSchedule(db, template, "paused")

        const response = await changeStatus(schedule.id, change.action)

        expect(timeOf((response.body as ScheduleDto).nextRunAt)).toBe(timeOf(dailyFirstRun))
        expect((await storedSchedule(schedule.id))!.nextRunAt?.getTime()).toBe(timeOf(dailyFirstRun))
      })
    } else {
      test.each(change.from)("clears the next run of a %s schedule", async (from) => {
        const { organization } = await signedInMember("owner")
        const template = await templateFor(organization)
        const schedule = await insertSchedule(db, template, from, { nextRunAt: from === "active" ? new Date(dailyFirstRun) : null })

        const response = await changeStatus(schedule.id, change.action)

        expect((response.body as ScheduleDto).nextRunAt).toBeNull()
        expect((await storedSchedule(schedule.id))!.nextRunAt).toBeNull()
      })
    }

    test.each(change.refused)("refuses a %s schedule with conflict and changes nothing", async (from) => {
      const { organization } = await signedInMember("owner")
      const template = await templateFor(organization)
      const schedule = await insertSchedule(db, template, from)

      expectError(await changeStatus(schedule.id, change.action), 409, "conflict")
      expect(await storedSchedule(schedule.id)).toEqual(schedule)
    })

    test("keeps who created the schedule, and when", async () => {
      const { organization } = await signedInMember("owner")
      const template = await templateFor(organization)
      const schedule = await insertSchedule(db, template, change.from[0]!)

      expectStatus(await changeStatus(schedule.id, change.action), 200)

      expectCreationKept(schedule, await storedSchedule(schedule.id))
    })
  })
}

describe("POST /api/schedules/:scheduleId/restore", () => {
  test("refuses a schedule whose template is archived with conflict and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization, { status: "archived" })
    const schedule = await insertSchedule(db, template, "archived")

    expectError(await changeStatus(schedule.id, "restore"), 409, "conflict")
    expect(await storedSchedule(schedule.id)).toEqual(schedule)
  })
})

// Every route on one schedule, with a request that would succeed on an active schedule (or archived, for restore)
const scheduleRoutes: { name: string, status: ScheduleStatus, send: (scheduleId: string) => PromiseLike<request.Response> }[] = [
  { name: "PATCH /api/schedules/:scheduleId", status: "active", send: id => editSchedule(id, { runNamePattern: "{template}" }) },
  ...statusChanges.map(change => ({
    name: `POST /api/schedules/:scheduleId/${change.action}`,
    status: change.from[0]!,
    send: (id: string) => changeStatus(id, change.action),
  })),
]

for (const route of scheduleRoutes) {
  describe(`${route.name} who can change it`, () => {
    async function scheduleOn(organization: Organization): Promise<{ template: Template, schedule: Schedule }> {
      const template = await templateFor(organization)
      return { template, schedule: await insertSchedule(db, template, route.status) }
    }

    test("lets a member with edit access to the template change it", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { template, schedule } = await scheduleOn(organization)
      await grant(db, template.id, { organization, memberId: member.id }, "edit")

      expectStatus(await route.send(schedule.id), 200)
    })

    test.each(["view", "run"] as const)("refuses a member with %s access with forbidden and changes nothing", async (level) => {
      const { organization, member } = await signedInMember("viewer")
      const { template, schedule } = await scheduleOn(organization)
      await grant(db, template.id, { organization, memberId: member.id }, level)

      expectError(await route.send(schedule.id), 403, "forbidden")
      expect(await storedSchedule(schedule.id)).toEqual(schedule)
    })

    test("refuses a schedule on a template the member can't see with not_found and changes nothing", async () => {
      const { organization } = await signedInMember("viewer")
      const { schedule } = await scheduleOn(organization)

      expectError(await route.send(schedule.id), 404, "not_found")
      expect(await storedSchedule(schedule.id)).toEqual(schedule)
    })

    test("refuses another organization's schedule with not_found and changes nothing", async () => {
      const { schedule } = await scheduleOn(await createOrganization(db))
      await signedInMember("owner")

      expectError(await route.send(schedule.id), 404, "not_found")
      expect(await storedSchedule(schedule.id)).toEqual(schedule)
    })

    test("refuses a schedule ID that doesn't exist with not_found", async () => {
      await signedInMember("owner")

      expectError(await route.send(typeIdForTable("schedules").toString()), 404, "not_found")
    })

    test.each([
      ["a schedule ID that isn't a TypeID", "not-an-id"],
      ["a schedule ID for another table", typeIdForTable("templates").toString()],
    ])("refuses %s with validation_failed", async (_description, scheduleId) => {
      await signedInMember("owner")

      expectError(await route.send(scheduleId), 400, "validation_failed")
    })

    test("refuses a signed-out request with unauthorized", async () => {
      const { schedule } = await scheduleOn(await createOrganization(db))

      expectError(await route.send(schedule.id), 401, "unauthorized")
    })
  })
}
