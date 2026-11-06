import type { CreatedFields, UpdatedFields } from "./common.ts"
import type { AssigneeType } from "../domain/assignees.ts"
import type { FieldValue } from "../domain/fields.ts"
import type { RunStatus, RunStepStatus } from "../domain/runs.ts"

// TODO (person): request schemas for the run routes

export type RunDto = {
  id: string
  templateVersionId: string
  scheduleId: string | null
  name: string
  timezone: string
  status: RunStatus
  completedAt: string | null
} & CreatedFields & UpdatedFields

export type RunStepDto = {
  id: string
  runId: string
  templateStepId: string
  status: RunStepStatus
  assigneeType: AssigneeType | null
  assigneeMemberId: string | null
  assigneeTeamId: string | null
  assigneeRole: string | null
  dueAt: string | null
  completedAt: string | null
  completedBy: string | null
  skipReason: string | null
} & CreatedFields & UpdatedFields

export type RunFieldValueDto = {
  id: string
  runStepId: string
  templateFieldId: string
  value: FieldValue | null
  updatedBy: string | null
} & CreatedFields & UpdatedFields

export type StepNoteDto = {
  id: string
  runStepId: string
  body: string
} & CreatedFields
