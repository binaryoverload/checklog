import { describe, expect, test } from "vitest"

import { scheduleRecurrenceSchema } from "@checklog/shared/domain"

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

  // Fails while the refine's path is ["count", "endDate"], which Zod reads as the nested path count.endDate
  test.fails("reports both a count and an end date on a field that exists", () => {
    const result = scheduleRecurrenceSchema.safeParse({ ...recurrence, count: 5, endDate: "2027-01-01" })
    const paths = result.error?.issues.map(issue => issue.path.join(".")) ?? []

    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) expect(["count", "endDate"]).toContain(path)
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
