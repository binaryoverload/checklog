import type { Run, RunFieldValue, RunStep, StepNote } from "@/util/types.ts"
import type { RunDto, RunFieldValueDto, RunStepDto, StepNoteDto } from "@checklog/shared/api"

export function toRunDto(_row: Run): RunDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toRunDto isn't written yet")
}

export function toRunStepDto(_row: RunStep): RunStepDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toRunStepDto isn't written yet")
}

export function toRunFieldValueDto(_row: RunFieldValue): RunFieldValueDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toRunFieldValueDto isn't written yet")
}

export function toStepNoteDto(_row: StepNote): StepNoteDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toStepNoteDto isn't written yet")
}
