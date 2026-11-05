import type { Schedule } from "@/util/types.ts"
import type { ScheduleDto } from "@checklog/shared/api"

export function toScheduleDto(_row: Schedule): ScheduleDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toScheduleDto isn't written yet")
}
