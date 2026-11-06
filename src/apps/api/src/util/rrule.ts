import rrule from "rrule"
import type { ByWeekday } from "rrule"

import type { ScheduleRecurrence } from "@checklog/shared/domain"
import { filterUndefined, jsDateToUTCISODate, jsDateToUTCISOTime, toArray } from "@checklog/shared/utils"

const weekdayNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const

function weekdayIndex(day: ByWeekday): number {
  if (typeof day === "number") return day
  if (typeof day === "string") return rrule.Weekday.fromStr(day).weekday
  return day.weekday
}

export function recurrenceToRRule(recurrence: ScheduleRecurrence, timezone: string): rrule.RRule {
  const startDate = recurrence.startDate.split("-").map(Number) as [number, number, number]
  const startTime = recurrence.time.split(":").map(Number) as [number, number]

  const endDate = recurrence.endDate ? recurrence.endDate.split("-").map(Number) as [number, number, number] : undefined

  // Filter undefined because a undefined set value can cause unwanted behavior in RRule
  return new rrule.RRule(filterUndefined({
    freq: rrule.Frequency[recurrence.frequency.toUpperCase() as keyof typeof rrule.Frequency],
    interval: recurrence.interval,
    count: recurrence.count,
    dtstart: rrule.datetime(startDate[0], startDate[1], startDate[2], startTime[0], startTime[1]),
    until: endDate ? rrule.datetime(endDate[0], endDate[1], endDate[2], 23, 59, 59) : undefined,
    byweekday: recurrence.weekdays?.map(day => weekdayNames.indexOf(day)),
    bymonth: recurrence.months,
    tzid: timezone,
  }))
}

export function rruleToRecurrence({ options, origOptions }: rrule.RRule): ScheduleRecurrence {
  const weekdays = toArray(origOptions.byweekday)?.map(day => weekdayNames[weekdayIndex(day)]!)

  return {
    frequency: rrule.Frequency[options.freq].toLowerCase() as ScheduleRecurrence["frequency"],
    interval: origOptions.interval ?? undefined,
    count: origOptions.count ?? undefined,
    startDate: jsDateToUTCISODate(options.dtstart),
    time: jsDateToUTCISOTime(options.dtstart, { includeSeconds: false }),
    endDate: options.until ? jsDateToUTCISODate(options.until) : undefined,
    weekdays: weekdays,
    months: toArray(origOptions.bymonth),
  }
}
