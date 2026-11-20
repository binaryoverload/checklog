import z from "zod"

import { assigneeSchema } from "../domain/assignees.ts"
import { fieldKeySchema, fieldValueSchema } from "../domain/fields.ts"
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
