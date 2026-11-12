import { and, eq, gt, sql } from "drizzle-orm"
import { sortBy } from "es-toolkit"
import { Router } from "express"
import z from "zod"

import { assertTemplateAccessLevel } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { templateFields, templateSteps } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toTemplateFieldDto } from "@/mappers/templates.ts"
import { requireDraft } from "@/services/templates.ts"
import { templateFieldOrderBodySchema } from "@checklog/shared/api"
import { diffArrays, typeIdParamsSchema } from "@checklog/shared/utils"

export const templateFieldsRouter = Router()

templateFieldsRouter.post("/:id/draft/steps/:stepId/fields", route({ body: z.any(), params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps" }) }, async ({
  body, params, member, organization, res,
}) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  // TODO
  res.send("ok")
}))

templateFieldsRouter.patch("/:id/draft/steps/:stepId/fields/:fieldId", route({ body: z.any(), params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps", fieldId: "templateFields" }) }, async ({ body, params, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  // TODO
  res.send("ok")
}))

templateFieldsRouter.put("/:id/draft/steps/:stepId/fields/order", route({ body: templateFieldOrderBodySchema, params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps" }) }, async ({
  body, params, member, organization, res,
}) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  const fields = await db.transaction(async (tx) => {
    const draft = await requireDraft(tx, { member, organization }, params.id)
    const [step] = await tx.select({ id: templateSteps.id }).from(templateSteps).where(and(
      eq(templateSteps.templateVersionId, draft.id),
      eq(templateSteps.id, params.stepId),
    ))
    if (!step) throw new HttpError("not_found", "Step not found")

    const fields = await tx.select().from(templateFields).where(and(
      eq(templateFields.templateVersionId, draft.id),
      eq(templateFields.templateStepId, params.stepId),
    ))

    const { onlyInArr1, onlyInArr2 } = diffArrays(body.fieldIds, fields.map(field => field.id))

    if (onlyInArr1.length > 0) {
      throw new HttpError("validation_failed", `Unknown field IDs: ${onlyInArr1.join(", ")}`)
    }

    if (onlyInArr2.length > 0) {
      throw new HttpError("validation_failed", `Missing field IDs: ${onlyInArr2.join(", ")}`)
    }

    return await tx.update(templateFields)
      .set({ position: sql`array_position(${sql.param(body.fieldIds)}::text[], ${templateFields.id}) - 1` })
      .where(and(
        eq(templateFields.templateVersionId, draft.id),
        eq(templateFields.templateStepId, params.stepId),
      ))
      .returning()
  })

  res.json(sortBy(fields, ["position"]).map(toTemplateFieldDto))
}))

templateFieldsRouter.delete("/:id/draft/steps/:stepId/fields/:fieldId", route({ params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps", fieldId: "templateFields" }) }, async ({
  params, member, organization, res,
}) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  await db.transaction(async (tx) => {
    const draft = await requireDraft(tx, { member, organization }, params.id)

    const [deletedRow] = await tx.delete(templateFields)
      .where(and(
        eq(templateFields.templateVersionId, draft.id),
        eq(templateFields.templateStepId, params.stepId),
        eq(templateFields.id, params.fieldId),
      ))
      .returning({ position: templateFields.position })

    if (!deletedRow) throw new HttpError("not_found", "Field not found")

    await tx.update(templateFields)
      .set({ position: sql`${templateFields.position} - 1` })
      .where(and(
        eq(templateFields.templateVersionId, draft.id),
        eq(templateFields.templateStepId, params.stepId),
        gt(templateFields.position, deletedRow.position),
      ))
  })

  res.sendStatus(204)
}))
