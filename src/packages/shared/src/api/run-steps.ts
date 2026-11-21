import z from "zod"

import type { ApprovalRequestDto } from "./approvals.ts"
import type { CreatedFields, UpdatedFields } from "./common.ts"
import type { TemplateStepDto, TemplateFieldDto } from "./templates.ts"
import { assigneeSchema } from "../domain/assignees.ts"
import type { Assignee } from "../domain/assignees.ts"
import { fieldKeySchema, fieldValueSchema } from "../domain/fields.ts"
import type { FieldValue } from "../domain/fields.ts"
import type { RunStepStatus } from "../domain/runs.ts"
import { requiredString } from "../utils/zod.ts"

export const setStepValuesBodySchema = z.strictObject({
  values: z.record(fieldKeySchema, fieldValueSchema.nullable())
    .refine(v => Object.keys(v).length > 0, "Must have at least one value"),
})

export const addStepNoteBodySchema = z.strictObject({ body: requiredString().max(500, "Note too long") })

export const reassignStepBodySchema = z.strictObject({
  assignee: assigneeSchema.nullable(),
})

export const skipStepBodySchema = z.strictObject({
  reason: requiredString(),
})

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
  approval: ApprovalRequestDto | null
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
