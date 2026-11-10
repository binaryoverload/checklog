import z from "zod"

import type { CreatedFields, UpdatedFields } from "./common.ts"
import { assigneeSchema } from "../domain/assignees.ts"
import type { Assignee } from "../domain/assignees.ts"
import type { FieldOptions, FieldType } from "../domain/fields.ts"
import { templateAccessLevelSchema, templateStepKindSchema, templateStepRuleIssues } from "../domain/templates.ts"
import type { TemplateAccessLevel, TemplateStatus, TemplateStepKind, TemplateVersionStatus } from "../domain/templates.ts"
import { requiredString } from "../utils/zod.ts"

export const templateNameSchema = requiredString().max(200)

export const createTemplateBodySchema = z.strictObject({
  name: templateNameSchema,
  description: z.string().max(2000).nullable().optional(),
})
export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>

export const updateTemplateBodySchema = createTemplateBodySchema.partial().refine(d => Object.keys(d).length > 0, "At least one field must be provided")
export type UpdateTemplateBody = z.infer<typeof updateTemplateBodySchema>

export type TemplateDto = {
  id: string
  name: string
  description: string | null
  status: TemplateStatus
  currentVersionId: string | null
} & CreatedFields & UpdatedFields

export type TemplateDetails = TemplateDto & {
  currentVersion: TemplateVersionDto | null
  draftVersion: TemplateVersionDto | null
}

export type TemplateVersionDto = {
  id: string
  templateId: string
  version: number
  status: TemplateVersionStatus
  publishedAt: string | null
  publishedBy: string | null
} & CreatedFields & UpdatedFields

export type TemplateVersionWithStepsDto = TemplateVersionDto & {
  steps: TemplateStepWithFieldsDto[]
}

const templateStepFields = z.strictObject({
  kind: templateStepKindSchema,
  title: requiredString().max(200),
  position: z.number().int().min(0).optional(),
  instructions: z.string().max(2000).nullable().optional(),
  isHalt: z.boolean(),
  skippable: z.boolean(),
  assignee: assigneeSchema.nullable().optional(),
  dueOffset: z.iso.duration().nullable().optional(),
})

export const templateStepCreateBodySchema = templateStepFields.extend({
  kind: templateStepKindSchema.default("task"),
  isHalt: z.boolean().default(false),
  skippable: z.boolean().default(false),
}).superRefine((step, ctx) => {
  for (const issue of templateStepRuleIssues(step)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message })
  }
})

export type TemplateStepCreateBody = z.infer<typeof templateStepCreateBodySchema>

export const templateStepUpdateBodySchema = templateStepFields
  .omit({ position: true })
  .partial()
  .extend({ updatedAt: z.iso.datetime() })
  .refine(d => Object.keys(d).some(key => key !== "updatedAt"), "At least one field must be provided")
export type TemplateStepUpdateBody = z.infer<typeof templateStepUpdateBodySchema>

export type TemplateStepDto = {
  id: string
  templateVersionId: string
  kind: TemplateStepKind
  position: number
  title: string
  instructions: string | null
  isHalt: boolean
  skippable: boolean
  assignee: Assignee | null
  assigneeMissing: boolean
  dueOffset: string | null
} & CreatedFields & UpdatedFields

export type TemplateStepWithFieldsDto = TemplateStepDto & {
  fields: TemplateFieldDto[]
}

// TODO: The request schema for a template field
export type TemplateFieldDto = {
  id: string
  templateVersionId: string
  templateStepId: string
  position: number
  required: boolean
  key: string
  label: string
  helpText: string | null
  type: FieldType
  options: FieldOptions
} & CreatedFields & UpdatedFields

export const templateAccessUpsertBodySchema = z.union([
  z.strictObject({ memberId: z.string(), level: templateAccessLevelSchema }),
  z.strictObject({ teamId: z.string(), level: templateAccessLevelSchema }),
])

export type TemplateAccessDto = {
  id: string
  templateId: string
  memberId: string | null
  teamId: string | null
  level: TemplateAccessLevel
} & CreatedFields & UpdatedFields

export type TemplateAccessWithNameDto = TemplateAccessDto & { name: string }
