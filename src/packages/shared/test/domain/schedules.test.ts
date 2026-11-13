import { describe, expect, test } from "vitest"

import { scheduleRecurrenceSchema, timezoneSchema } from "@checklog/shared/domain"

const recurrence = { frequency: "weekly", startDate: "2026-11-10", time: "09:00" }

describe("scheduleRecurrenceSchema", () => {
  test.each([
    ["no end", {}],
    ["a count", { count: 5 }],
    ["an end date", { endDate: "2027-01-01" }],
  ])("accepts a recurrence with %s", (_, end) => {
    expect(scheduleRecurrenceSchema.safeParse({ ...recurrence, ...end }).success).toBe(true)
  })

  test("refuses both a count and an end date", () => {
    expect(scheduleRecurrenceSchema.safeParse({ ...recurrence, count: 5, endDate: "2027-01-01" }).success).toBe(false)
  })

  test("reports both a count and an end date on endDate", () => {
    const result = scheduleRecurrenceSchema.safeParse({ ...recurrence, count: 5, endDate: "2027-01-01" })

    expect(result.error?.issues.map(issue => issue.path)).toEqual([["endDate"]])
  })

  test.each([
    ["an interval of 0", { interval: 0 }],
    ["a count of 0", { count: 0 }],
    ["month 13", { months: [13] }],
    ["an unknown weekday", { weekdays: ["funday"] }],
    ["a time with seconds", { time: "09:00:00" }],
    ["an unknown frequency", { frequency: "fortnightly" }],
  ])("refuses %s", (_, change) => {
    expect(scheduleRecurrenceSchema.safeParse({ ...recurrence, ...change }).success).toBe(false)
  })
})

describe("timezoneSchema", () => {
  test.each(["Europe/London", "America/New_York", "UTC"])("accepts %s", (zone) => {
    expect(timezoneSchema.safeParse(zone).success).toBe(true)
  })

  test.each([
    ["a name that isn't a zone", "Mars/Olympus_Mons"],
    ["a fixed offset", "+01:00"],
    ["an empty string", ""],
    ["a value that isn't a string", 1],
  ])("refuses %s", (_description, zone) => {
    expect(timezoneSchema.safeParse(zone).success).toBe(false)
  })

  test.each([
    ["a name in the wrong case", "europe/london", "Europe/London"],
    ["Etc/UTC", "Etc/UTC", "UTC"],
    ["an older alias", "US/Eastern", "America/New_York"],
    ["a canonical name", "Europe/London", "Europe/London"],
  ])("parses %s to its canonical name", (_description, zone, expected) => {
    expect(timezoneSchema.parse(zone)).toBe(expected)
  })

  test("explains the refusal with an example zone", () => {
    const result = timezoneSchema.safeParse("Mars/Olympus_Mons")

    expect(result.error?.issues[0]?.message).toBe("Must be an IANA timezone, such as Europe/London")
  })
})
