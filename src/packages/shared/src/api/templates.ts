import z from "zod"

import type { CreatedFields, UpdatedFields } from "./common.ts"
import type { AssigneeType } from "../domain/assignees.ts"
import type { FieldOptions, FieldType } from "../domain/fields.ts"
import type { TemplateAccessLevel, TemplateStatus, TemplateStepKind, TemplateVersionStatus } from "../domain/templates.ts"
import { typeIdSchema } from "../utils/typeid.ts"
import { requiredString } from "../utils/zod.ts"

export const templateNameSchema = requiredString().max(200)

export const templateParamsSchema = z.object({ templateId: typeIdSchema("templates") })

export const createTemplateBodySchema = z.strictObject({
  name: templateNameSchema,
  description: z.string().max(2000).nullable().optional(),
})
export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>

export const updateTemplateBodySchema = createTemplateBodySchema.partial()
export type UpdateTemplateBody = z.infer<typeof updateTemplateBodySchema>

export type TemplateDto = {
  id: string
  name: string
  description: string | null
  status: TemplateStatus
  currentVersionId: string | null
} & CreatedFields & UpdatedFields

export type TemplateVersionDto = {
  id: string
  templateId: string
  version: number
  status: TemplateVersionStatus
  publishedAt: string | null
  publishedBy: string | null
} & CreatedFields & UpdatedFields

// TODO: The request schemas for template step
export type TemplateStepDto = {
  id: string
  templateVersionId: string
  kind: TemplateStepKind
  position: number
  title: string
  instructions: string | null
  isHalt: boolean
  skippable: boolean
  assigneeType: AssigneeType | null
  assigneeMemberId: string | null
  assigneeTeamId: string | null
  assigneeRole: string | null
  dueOffset: string | null
} & CreatedFields & UpdatedFields

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

// TODO: The request schema for a template access grant
export type TemplateAccessDto = {
  id: string
  templateId: string
  memberId: string | null
  teamId: string | null
  level: TemplateAccessLevel
} & CreatedFields & UpdatedFields
