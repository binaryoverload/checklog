import { Frequency, RRule } from "rrule"
import type { ByWeekday, WeekdayStr } from "rrule"
import z from "zod"

export const scheduleStatuses = ["active", "paused", "archived"] as const
export const scheduleStatusSchema = z.enum(scheduleStatuses)
export type ScheduleStatus = z.infer<typeof scheduleStatusSchema>

export const scheduleRecurrenceSchema = z.object({
  frequency: z.enum(["yearly", "monthly", "weekly", "daily", "hourly"]),
  timezone: z.string(),
  interval: z.number().min(1).optional(),
  count: z.number().min(1).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  weekdays: z.array(z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])).optional(),
  months: z.array(z.number().min(1).max(12)).optional(),
})

export type ScheduleRecurrence = z.infer<typeof scheduleRecurrenceSchema>

const weekdayToRRuleMapping: Record<NonNullable<ScheduleRecurrence["weekdays"]>[number], WeekdayStr> = {
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
  sunday: "SU",
}

const rruleToWeekdayMapping: Record<WeekdayStr, NonNullable<ScheduleRecurrence["weekdays"]>[number]> = {
  MO: "monday",
  TU: "tuesday",
  WE: "wednesday",
  TH: "thursday",
  FR: "friday",
  SA: "saturday",
  SU: "sunday",
}

export function recurrenceToRRule(recurrence: ScheduleRecurrence): RRule {
  return new RRule({
    freq: Frequency[recurrence.frequency.toUpperCase() as keyof typeof Frequency],
    interval: recurrence.interval,
    count: recurrence.count,
    dtstart: recurrence.startDate,
    until: recurrence.endDate,
    byweekday: recurrence.weekdays?.map(day => weekdayToRRuleMapping[day]),
    bymonth: recurrence.months,
    tzid: recurrence.timezone,
  })
}
