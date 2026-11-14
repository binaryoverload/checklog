import z from "zod"

import type { CreatedFields, UpdatedFields } from "./common.ts"
import { paginationQuerySchema } from "./pagination.ts"
import type { TemplateFieldDto, TemplateStepDto } from "./templates.ts"
import type { Assignee } from "../domain/assignees.ts"
import type { FieldValue } from "../domain/fields.ts"
import { runListScopeSchema, runStatusSchema } from "../domain/runs.ts"
import type { RunStatus, RunStepStatus } from "../domain/runs.ts"

export const listRunsQuerySchema = paginationQuerySchema()
  .and(z.object({
    scope: runListScopeSchema.default("all"),
    status: runStatusSchema.optional(),
  }))
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>

export type RunDto = {
  id: string
  templateId: string
  templateVersionId: string
  scheduleId: string | null
  name: string
  timezone: string
  status: RunStatus
  completedAt: string | null
} & CreatedFields & UpdatedFields

export type RunWithDetailsDto = RunDto & { steps: RunStepWithDetailsDto[] }

export type RunStepDto = {
  id: string
  runId: string
  templateStepId: string
  status: RunStepStatus
  assignee: Assignee | null
  assigneeMissing: boolean
  dueAt: string | null
  completedAt: string | null
  completedBy: string | null
  skipReason: string | null
} & CreatedFields & UpdatedFields

export type RunStepWithDetailsDto = RunStepDto & {
  blocked: boolean
  templateStep: TemplateStepDto
  fields: RunFieldWithValueDto[]
  notes: StepNoteDto[]
}

export type RunFieldWithValueDto = TemplateFieldDto & {
  value: FieldValue | null
  valueUpdatedBy: string | null
  valueUpdatedAt: string | null
}

export type StepNoteDto = {
  id: string
  runStepId: string
  body: string
} & CreatedFields
