import {
  and, eq, gt, sql,
} from "drizzle-orm"
import { Router } from "express"
import { Http } from "winston/lib/winston/transports/index"
import z from "zod"

import { assertTemplateAccessLevel } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { templateFields } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { requireDraft } from "@/services/templates.ts"
import { typeIdParamsSchema } from "@checklog/shared/utils"

export const templateFieldsRouter = Router()

templateFieldsRouter.post("/:id/draft/steps/:stepId/fields", route({ body: z.any(), params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps" }) }, async ({
  body, params, member, organization, res,
}) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  res.send("ok")
}))

templateFieldsRouter.patch("/:id/draft/steps/:stepId/fields/:fieldId", route({ body: z.any(), params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps", fieldId: "templateFields" }) }, async ({ body, params, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  res.send("ok")
}))

templateFieldsRouter.put("/:id/draft/steps/:stepId/fields/order", route({ body: z.any(), params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps" }) }, async ({
  body, params, member, organization, res,
}) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  res.send("ok")
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
