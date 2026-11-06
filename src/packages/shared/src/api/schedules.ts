// TODO: request schemas for the schedule routes

import type { CreatedFields, UpdatedFields } from "./common.ts"
import type { ScheduleRecurrence, ScheduleStatus } from "../domain/schedules.ts"

export type ScheduleDto = {
  id: string
  templateId: string
  status: ScheduleStatus
  recurrence: ScheduleRecurrence
  timezone: string
  nextRunAt: string | null
  runNamePattern: string
} & CreatedFields & UpdatedFields
