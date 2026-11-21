import z from "zod"

import type { CreatedFields, UpdatedFields } from "./common.ts"
import { runNamePatternSchema, scheduleRecurrenceSchema, timezoneSchema } from "../domain/schedules.ts"
import type { ScheduleRecurrence, ScheduleStatus } from "../domain/schedules.ts"
import { typeIdSchema } from "../utils/typeid.ts"

export const listSchedulesQuerySchema = z.object({
  templateId: typeIdSchema("templates"),
})

export const createScheduleSchema = z.strictObject({
  templateId: typeIdSchema("templates"),
  timezone: timezoneSchema,
  recurrence: scheduleRecurrenceSchema,
  runNamePattern: runNamePatternSchema.default("{template} - {date} {time}"),
})

export const updateScheduleSchema = z.strictObject({
  timezone: timezoneSchema,
  recurrence: scheduleRecurrenceSchema,
  runNamePattern: runNamePatternSchema,
}).partial()

export type ScheduleDto = {
  id: string
  templateId: string
  status: ScheduleStatus
  recurrence: ScheduleRecurrence
  timezone: string
  nextRunAt: string | null
  runNamePattern: string
} & CreatedFields & UpdatedFields
