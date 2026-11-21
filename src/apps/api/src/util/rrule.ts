import { allowedWeekdays, RRuleTemporal } from "rrule-temporal"
import type { Freq, Weekday } from "rrule-temporal"
import { Temporal } from "temporal-polyfill"

import type { ScheduleRecurrence } from "@checklog/shared/domain"
import { toArray } from "@checklog/shared/utils"

const weekdayNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const

function toRRuleWeekday(day: typeof weekdayNames[number]): Weekday {
  return allowedWeekdays[weekdayNames.indexOf(day)]!
}

function fromRRuleWeekday(day: Weekday): typeof weekdayNames[number] {
  return weekdayNames[allowedWeekdays.indexOf(day)]!
}

export function recurrenceToRRule(recurrence: ScheduleRecurrence, timezone: string): RRuleTemporal {
  const [startYear, startMonth, startDay] = recurrence.startDate.split("-").map(Number) as [number, number, number]
  const [hour, minute] = recurrence.time.split(":").map(Number) as [number, number]
  const endDate = recurrence.endDate?.split("-").map(Number) as [number, number, number] | undefined

  return new RRuleTemporal({
    freq: recurrence.frequency.toUpperCase() as Freq,
    interval: recurrence.interval,
    count: recurrence.count,
    dtstart: Temporal.ZonedDateTime.from({
      year: startYear,
      month: startMonth,
      day: startDay,
      hour,
      minute,
      timeZone: timezone,
    }),
    until: endDate
      ? Temporal.ZonedDateTime.from({
          year: endDate[0],
          month: endDate[1],
          day: endDate[2],
          hour: 23,
          minute: 59,
          second: 59,
          timeZone: timezone,
        })
      : undefined,
    byDay: recurrence.weekdays?.map(toRRuleWeekday),
    byMonth: recurrence.months,
    tzid: timezone,
  })
}

export function rruleToRecurrence(rrule: RRuleTemporal): ScheduleRecurrence {
  const options = rrule.options()

  const weekdays = toArray(options.byDay)?.map(w => fromRRuleWeekday(w as Weekday))

  return {
    frequency: options.freq.toLowerCase() as ScheduleRecurrence["frequency"],
    interval: options.interval ?? 1,
    count: options.count ?? undefined,
    startDate: options.dtstart.toPlainDate().toString(),
    time: options.dtstart.toPlainTime().toString({ smallestUnit: "minute" }),
    endDate: options.until ? options.until.toPlainDate().toString() : undefined,
    weekdays: weekdays,
    months: options.byMonth?.map(Number),
  }
}
