import z from "zod"

import type { CreatedFields, UpdatedFields } from "./common.ts"
import { pageQuerySchema } from "./pagination.ts"
import type { RunStepWithDetailsDto } from "./run-steps.ts"
import { runListScopeSchema, runStatusSchema } from "../domain/runs.ts"
import type { RunStatus } from "../domain/runs.ts"
import { typeIdSchema } from "../utils/typeid.ts"
import { requiredString } from "../utils/zod.ts"

export const listRunsQuerySchema = pageQuerySchema()
  .and(z.object({
    scope: runListScopeSchema.default("all"),
    status: runStatusSchema.optional(),
  }))
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>

export const createRunBodySchema = z.strictObject({
  templateId: typeIdSchema("templates"),
  name: requiredString().max(200).optional(),
})
export type CreateRunBody = z.infer<typeof createRunBodySchema>

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
