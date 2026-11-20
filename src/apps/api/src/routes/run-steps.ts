import { eq, and } from "drizzle-orm"
import { Router } from "express"

import { db } from "@/db/index.ts"
import { runFieldValues, stepNotes, templateFields } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toRunWithDetailsDto, toStepNoteDto } from "@/mappers/runs.ts"
import { loadRunRows, requireRunStep } from "@/services/runs.ts"
import { buildConflictUpdateColumns } from "@/util/db.ts"
import { addStepNoteBodySchema, setStepValuesBodySchema } from "@checklog/shared/api"
import type { ApiErrorDetail } from "@checklog/shared/api"
import { validateFieldValue } from "@checklog/shared/domain"
import { dateInTimezone, typeIdParamsSchema } from "@checklog/shared/utils"

export const runStepsRouter = Router()

runStepsRouter.put("/:id/steps/:stepId/values", route({
  params: typeIdParamsSchema({ id: "runs", stepId: "runSteps" }),
  body: setStepValuesBodySchema,
}, async ({ params, body, member, organization, res, timezone }) => {
  const runData = await db.transaction(async (tx) => {
    const { run, step, templateId } = await requireRunStep(tx, { member, organization }, params.id, params.stepId, "assignee")

    if (run.status !== "in_progress") throw new HttpError("conflict", "Run not in progress")
    if (step.status !== "pending") throw new HttpError("conflict", "Step not pending")

    const values = body.values

    const fields = await tx.select().from(templateFields)
      .where(and(
        eq(templateFields.templateStepId, step.templateStepId),
        eq(templateFields.templateVersionId, run.templateVersionId),
      ))

    const now = new Date()

    const rowsToInsert: typeof runFieldValues.$inferInsert[] = []
    const validationIssues: ApiErrorDetail[] = []
    for (const key of Object.keys(values)) {
      const field = fields.find(f => f.key === key)
      if (!field) {
        validationIssues.push({ location: "body", path: ["values", key], message: "Unknown field" })
        continue
      }

      const value = values[key] ?? null

      const issues = validateFieldValue(field.options, value, { date: dateInTimezone(now, timezone.name), datetime: now })
      validationIssues.push(...issues.map((i): ApiErrorDetail => ({ location: "body", path: ["values", key, ...i.path], message: i.message })))

      rowsToInsert.push({
        runStepId: step.id,
        templateFieldId: field.id,
        organizationId: organization.id,
        createdBy: member.userId,
        updatedBy: member.userId,
        value,
      })
    }

    if (validationIssues.length) throw new HttpError("validation_failed", "Invalid fields", validationIssues)

    await tx.insert(runFieldValues).values(rowsToInsert).onConflictDoUpdate({
      target: [runFieldValues.runStepId, runFieldValues.templateFieldId],
      set: buildConflictUpdateColumns(runFieldValues, ["updatedBy", "value"]),
    })

    return await loadRunRows(tx, run, templateId)
  })
  res.json(toRunWithDetailsDto(runData))
}))

runStepsRouter.post("/:id/steps/:stepId/complete", route({ params: typeIdParamsSchema({ id: "runs", stepId: "runSteps" }) }, ({ res }) => {
  throw new Error("Not implemented")
}))

runStepsRouter.post("/:id/steps/:stepId/skip", route({ params: typeIdParamsSchema({ id: "runs", stepId: "runSteps" }) }, ({ res }) => {
  throw new Error("Not implemented")
}))

runStepsRouter.post("/:id/steps/:stepId/notes", route({
  params: typeIdParamsSchema({ id: "runs", stepId: "runSteps" }),
  body: addStepNoteBodySchema,
}, async ({ params, body, member, organization, res }) => {
  const note = await db.transaction(async (tx) => {
    const { step } = await requireRunStep(tx, { member, organization }, params.id, params.stepId, "view")

    const [note] = await tx.insert(stepNotes).values({
      runStepId: step.id,
      organizationId: organization.id,
      createdBy: member.userId,
      body: body.body,
    }).returning()
    if (!note) throw new HttpError("internal", "Failed to create note")
    return note
  })

  res.json(toStepNoteDto(note))
}))

runStepsRouter.patch("/:id/steps/:stepId/assignee", route({ params: typeIdParamsSchema({ id: "runs", stepId: "runSteps" }) }, ({ res }) => {
  throw new Error("Not implemented")
}))
