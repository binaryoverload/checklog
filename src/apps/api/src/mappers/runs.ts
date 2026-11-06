import type { Run, RunFieldValue, RunStep, StepNote } from "@/util/types.ts"
import type { RunDto, RunFieldValueDto, RunStepDto, StepNoteDto } from "@checklog/shared/api"

export function toRunDto(row: Run): RunDto {
  return {
    id: row.id,
    templateVersionId: row.templateVersionId,
    scheduleId: row.scheduleId,
    name: row.name,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toRunStepDto(row: RunStep): RunStepDto {
  return {
    id: row.id,
    runId: row.runId,
    templateStepId: row.templateStepId,
    status: row.status,
    assigneeType: row.assigneeType,
    assigneeMemberId: row.assigneeMemberId,
    assigneeTeamId: row.assigneeTeamId,
    assigneeRole: row.assigneeRole,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy,
    skipReason: row.skipReason,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toRunFieldValueDto(row: RunFieldValue): RunFieldValueDto {
  return {
    id: row.id,
    runStepId: row.runStepId,
    templateFieldId: row.templateFieldId,
    value: row.value,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  }
}

export function toStepNoteDto(row: StepNote): StepNoteDto {
  return {
    id: row.id,
    runStepId: row.runStepId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  }
}
