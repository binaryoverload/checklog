import { RRuleTemporal } from "rrule-temporal"
import { afterEach, describe, expect, it } from "vitest"

import { recurrenceToRRule, rruleToRecurrence } from "@/util/rrule.ts"
import type { ScheduleRecurrence } from "@checklog/shared/domain"

const timezone = "Europe/London"

// The schedules table stores the rule's string form, so a round trip goes through it
function roundTrip(recurrence: ScheduleRecurrence, zone = timezone): ScheduleRecurrence {
  return rruleToRecurrence(new RRuleTemporal({ rruleString: recurrenceToRRule(recurrence, zone).toString() }))
}

const daily: ScheduleRecurrence = { frequency: "daily", interval: 1, startDate: "2026-11-05", time: "09:00" }

describe("recurrenceToRRule", () => {
  it("starts at the date and wall-clock time in the schedule's timezone", () => {
    expect(recurrenceToRRule(daily, timezone).toString()).toBe("DTSTART;TZID=Europe/London:20261105T090000\nRRULE:FREQ=DAILY")
  })

  it("maps weekdays to BYDAY", () => {
    const rule = recurrenceToRRule({ ...daily, frequency: "weekly", weekdays: ["monday", "wednesday", "sunday"] }, timezone)

    expect(rule.toString()).toContain("BYDAY=MO,WE,SU")
  })

  // RFC 5545 needs UNTIL in UTC when DTSTART has a TZID
  it.each([
    ["in winter, on UTC", "2026-12-31", timezone, "UNTIL=20261231T235959Z"],
    ["in summer, an hour ahead of UTC", "2026-07-31", timezone, "UNTIL=20260731T225959Z"],
    ["behind UTC, so on the next day there", "2026-12-31", "America/New_York", "UNTIL=20270101T045959Z"],
  ])("includes the whole end date, written in UTC: %s", (_description, endDate, zone, until) => {
    expect(recurrenceToRRule({ ...daily, endDate }, zone).toString()).toContain(until)
  })

  it("leaves out COUNT and UNTIL when there's no end", () => {
    const rule = recurrenceToRRule(daily, timezone)

    expect(rule.toString()).not.toMatch(/COUNT|UNTIL/)
    expect(rule.all((_date, index) => index < 2)).toHaveLength(2)
  })

  it("maps interval, count and months", () => {
    const rule = recurrenceToRRule({ ...daily, frequency: "yearly", interval: 2, count: 5, months: [3, 9] }, timezone)

    expect(rule.toString()).toContain("INTERVAL=2")
    expect(rule.toString()).toContain("COUNT=5")
    expect(rule.toString()).toContain("BYMONTH=3,9")
  })

  it("runs on the chosen weekdays", () => {
    const rule = recurrenceToRRule({ ...daily, frequency: "weekly", weekdays: ["monday", "sunday"] }, timezone)

    // 2026-11-05 is a Thursday
    expect(rule.all((_date, index) => index < 4).map(date => date.toString())).toEqual([
      "2026-11-08T09:00:00+00:00[Europe/London]",
      "2026-11-09T09:00:00+00:00[Europe/London]",
      "2026-11-15T09:00:00+00:00[Europe/London]",
      "2026-11-16T09:00:00+00:00[Europe/London]",
    ])
  })

  // The clocks go forward at 01:00 on 29 March 2026
  it("keeps the wall-clock time when the clocks change", () => {
    const rule = recurrenceToRRule({ frequency: "weekly", interval: 1, startDate: "2026-03-22", time: "09:00" }, timezone)

    expect(rule.all((_date, index) => index < 2).map(date => date.toString())).toEqual([
      "2026-03-22T09:00:00+00:00[Europe/London]",
      "2026-03-29T09:00:00+01:00[Europe/London]",
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

  it("returns an interval of 1 rather than leaving it out", () => {
    expect(roundTrip(daily).interval).toBe(1)
  })

  it("returns the time to the minute, without seconds", () => {
    expect(roundTrip(daily).time).toBe("09:00")
  })

  it("returns months as numbers", () => {
    expect(roundTrip({ ...daily, frequency: "yearly", months: [3, 9] }).months).toEqual([3, 9])
  })

  // UNTIL is stored in UTC, which is already the next day for a zone behind UTC
  it("reads the end date in the schedule's timezone, not in UTC", () => {
    expect(roundTrip({ ...daily, endDate: "2026-12-31" }, "America/New_York").endDate).toBe("2026-12-31")
  })

  it("doesn't fill in weekdays from the start date", () => {
    expect(roundTrip({ ...daily, frequency: "weekly" }).weekdays).toBeUndefined()
  })

  it("doesn't fill in months from the start date", () => {
    expect(roundTrip({ ...daily, frequency: "yearly" }).months).toBeUndefined()
  })
})

describe("with the server in another timezone", () => {
  const originalTimezone = process.env.TZ

  afterEach(() => {
    process.env.TZ = originalTimezone
  })

  // Rules carry their own zone, so the server's timezone mustn't change them
  it.each(["Europe/London", "America/New_York", "Asia/Kolkata"])("round trips unchanged with TZ=%s", (serverTimezone) => {
    process.env.TZ = serverTimezone
    const recurrence: ScheduleRecurrence = {
      frequency: "weekly",
      interval: 1,
      startDate: "2026-03-29",
      time: "00:30",
      endDate: "2026-10-25",
      weekdays: ["sunday"],
    }

    expect(roundTrip(recurrence)).toEqual(recurrence)
  })
})
