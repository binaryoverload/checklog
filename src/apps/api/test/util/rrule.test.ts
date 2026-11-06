import { RRule } from "rrule"
import { afterEach, describe, expect, it } from "vitest"

import { recurrenceToRRule, rruleToRecurrence } from "@/util/rrule.ts"
import type { ScheduleRecurrence } from "@checklog/shared/domain"

const timezone = "Europe/London"

// The schedules table stores the rule's string form, so a round trip goes through it
function roundTrip(recurrence: ScheduleRecurrence): ScheduleRecurrence {
  return rruleToRecurrence(RRule.fromString(recurrenceToRRule(recurrence, timezone).toString()))
}

const daily: ScheduleRecurrence = { frequency: "daily", startDate: "2026-11-05", time: "09:00" }

describe("recurrenceToRRule", () => {
  it("starts at the date and wall-clock time in the schedule's timezone", () => {
    expect(recurrenceToRRule(daily, timezone).toString()).toBe("DTSTART;TZID=Europe/London:20261105T090000\nRRULE:FREQ=DAILY")
  })

  it("maps weekdays to BYDAY", () => {
    const rule = recurrenceToRRule({ ...daily, frequency: "weekly", weekdays: ["monday", "wednesday", "sunday"] }, timezone)

    expect(rule.toString()).toContain("BYDAY=MO,WE,SU")
  })

  it("includes the whole end date", () => {
    const rule = recurrenceToRRule({ ...daily, endDate: "2026-12-31" }, timezone)

    expect(rule.toString()).toContain("UNTIL=20261231T235959")
  })

  // rrule treats a key set to undefined as set: interval: undefined stops it advancing, so all() never returns
  it("leaves rrule's defaults for options that aren't set", () => {
    const rule = recurrenceToRRule(daily, timezone)

    expect(rule.options.interval).toBe(1)
    expect(Object.values(rule.origOptions)).not.toContain(undefined)
  })

  it("maps interval, count and months", () => {
    const rule = recurrenceToRRule({ ...daily, frequency: "yearly", interval: 2, count: 5, months: [3, 9] }, timezone)

    expect(rule.toString()).toContain("INTERVAL=2")
    expect(rule.toString()).toContain("COUNT=5")
    expect(rule.toString()).toContain("BYMONTH=3,9")
  })

  it("runs on the chosen weekdays", () => {
    const rule = recurrenceToRRule({ ...daily, frequency: "weekly", weekdays: ["monday", "sunday"] }, timezone)

    // A rule with invalid weekdays never matches and all() never returns, so check them first
    expect(rule.toString()).toContain("BYDAY=MO,SU")
    // 2026-11-05 is a Thursday. Occurrences are floating dates: their UTC fields hold the wall-clock time
    expect(rule.all((_date, index) => index < 4).map(date => date.toISOString())).toEqual([
      "2026-11-08T09:00:00.000Z",
      "2026-11-09T09:00:00.000Z",
      "2026-11-15T09:00:00.000Z",
      "2026-11-16T09:00:00.000Z",
    ])
  })
})

describe("rruleToRecurrence", () => {
  const cases: [string, ScheduleRecurrence][] = [
    ["daily", daily],
    ["hourly", { ...daily, frequency: "hourly", time: "00:15" }],
    ["every other week on weekdays", { ...daily, frequency: "weekly", interval: 2, weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"] }],
    ["weekly on Sunday", { ...daily, frequency: "weekly", weekdays: ["sunday"] }],
    ["weekly on every day", { ...daily, frequency: "weekly", weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] }],
    ["weekly with no weekdays chosen", { ...daily, frequency: "weekly" }],
    ["monthly with no months chosen", { ...daily, frequency: "monthly" }],
    ["yearly in one month", { ...daily, frequency: "yearly", months: [3] }],
    ["yearly in several months", { ...daily, frequency: "yearly", months: [3, 9] }],
    ["a set number of times", { ...daily, count: 10 }],
    ["until an end date", { ...daily, endDate: "2026-12-31" }],
    ["starting just before midnight", { ...daily, startDate: "2026-12-31", time: "23:59" }],
  ]

  it.each(cases)("returns %s unchanged", (_name, recurrence) => {
    expect(roundTrip(recurrence)).toEqual(recurrence)
  })

  it("doesn't fill in weekdays rrule derives from the start date", () => {
    expect(roundTrip({ ...daily, frequency: "weekly" }).weekdays).toBeUndefined()
  })

  it("doesn't fill in months rrule derives from the start date", () => {
    expect(roundTrip({ ...daily, frequency: "yearly" }).months).toBeUndefined()
  })
})

describe("with the server in another timezone", () => {
  const originalTimezone = process.env.TZ

  afterEach(() => {
    process.env.TZ = originalTimezone
  })

  // Floating dates keep the wall-clock time in their UTC fields, so the server's own timezone mustn't change them
  it.each(["Europe/London", "America/New_York", "Asia/Kolkata"])("round trips unchanged with TZ=%s", (serverTimezone) => {
    process.env.TZ = serverTimezone
    const recurrence: ScheduleRecurrence = { frequency: "weekly", startDate: "2026-03-29", time: "00:30", endDate: "2026-10-25", weekdays: ["sunday"] }

    expect(roundTrip(recurrence)).toEqual(recurrence)
  })
})
