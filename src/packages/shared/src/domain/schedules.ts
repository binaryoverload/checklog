import z from "zod"

import { canonicalTimezone, isValidTimezone } from "../utils/time.ts"
import { requiredString } from "../utils/zod.ts"

export const scheduleStatuses = ["active", "paused", "archived"] as const
export const scheduleStatusSchema = z.enum(scheduleStatuses)
export type ScheduleStatus = z.infer<typeof scheduleStatusSchema>

export const timezoneSchema = z.string()
  .refine(isValidTimezone, "Must be an IANA timezone, such as Europe/London")
  .transform(canonicalTimezone)

export const scheduleRecurrenceSchema = z.object({
  frequency: z.enum(["yearly", "monthly", "weekly", "daily", "hourly"]),
  interval: z.number().int().min(1).default(1),
  count: z.number().int().min(1).max(1000).optional(),
  startDate: z.iso.date(),
  time: z.iso.time({ precision: -1 }),
  endDate: z.iso.date().optional(),
  weekdays: z.array(z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])).optional(),
  months: z.array(z.number().int().min(1).max(12)).optional(),
}).refine((data) => {
  if (data.count && data.endDate) {
    return false
  }
  return true
}, { error: "Cannot have both count and endDate", path: ["endDate"] })

export type ScheduleRecurrence = z.infer<typeof scheduleRecurrenceSchema>

export const validPlaceholders = [
  "{template}",
  "{date}",
  "{time}",
  "{week}",
]

export const runNamePatternSchema = requiredString().superRefine((val, ctx) => {
  const placeholders = [...val.matchAll(/({\w+})/g)].map(m => m[1]!)

  for (const ph of placeholders) {
    if (!validPlaceholders.includes(ph)) {
      ctx.addIssue({ code: "custom", message: `Invalid placeholder ${ph}` })
    }
  }
})
