import { RRule } from "rrule"

import { rruleToRecurrence } from "@/util/rrule.ts"
import type { Schedule } from "@/util/types.ts"
import type { ScheduleDto } from "@checklog/shared/api"

export function toScheduleDto(row: Schedule): ScheduleDto {
  return {
    id: row.id,
    templateId: row.templateId,
    status: row.status,
    recurrence: rruleToRecurrence(RRule.fromString(row.rrule)),
    timezone: row.timezone,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    runNamePattern: row.runNamePattern,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}
