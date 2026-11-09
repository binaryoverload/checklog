import { and, eq, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { sortBy, uniq, xor } from "es-toolkit"
import { Router } from "express"
import z from "zod"

import { assertTemplateAccessLevel, templateAccessLevel, visibleTemplatesWhere } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { templates, templateSteps, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toTemplateStepDto, toTemplateVersionDto } from "@/mappers/templates.ts"
import { ensureDraft } from "@/services/templates.ts"
import { diffArrays, typeIdParamSchema, typeIdParamsSchema, typeIdSchema } from "@checklog/shared/utils"

export const templateDraftsRouter = Router()

templateDraftsRouter.get("/:id/draft", route({ params: typeIdParamSchema("templates") }, async ({ params, member, organization, res }) => {
  const visible = visibleTemplatesWhere({ member, organization }, "view")

  const draft = alias(templateVersions, "draft")
  const [row] = await db
    .select({ draft })
    .from(templates)
    .leftJoin(draft, and(eq(draft.templateId, templates.id), eq(draft.status, "draft")))
    .where(and(eq(templates.id, params.id), visible))

  if (!row) throw new HttpError("not_found", "Template not found")

  res.json({
    draftVersion: row.draft ? toTemplateVersionDto(row.draft) : null,
  })
}))

templateDraftsRouter.post("/:id/draft/steps", route({ params: typeIdParamSchema("templates") }, async ({ params, member, organization, res }) => {
  throw new Error("Not implemented")
}))

templateDraftsRouter.put("/:id/draft/steps/order", route({
  params: typeIdParamSchema("templates"),
  body: z.strictObject({
    stepIds: z.array(typeIdSchema("templateSteps")).refine(ids => uniq(ids).length === ids.length, "Each step must appear once"),
  }),
}, async ({ params, body, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  const steps = await db.transaction(async (tx) => {
    const draft = await ensureDraft(tx, { member, organization }, params.id)
    const steps = await tx.select().from(templateSteps).where(eq(templateSteps.templateVersionId, draft.id))

    const { onlyInArr1, onlyInArr2 } = diffArrays(body.stepIds, steps.map(step => step.id))

    if (onlyInArr1.length > 0) {
      throw new HttpError("validation_failed", `Unknown step IDs: ${onlyInArr1.join(", ")}`)
    }

    if (onlyInArr2.length > 0) {
      throw new HttpError("validation_failed", `Missing step IDs: ${onlyInArr2.join(", ")}`)
    }

    return await tx.update(templateSteps)
      .set({ position: sql`array_position(${sql.param(body.stepIds)}::text[], ${templateSteps.id}) - 1` })
      .where(eq(templateSteps.templateVersionId, draft.id))
      .returning()
  })

  res.json(sortBy(steps, ["position"]).map(toTemplateStepDto))
}))

templateDraftsRouter.patch("/:id/draft/steps/:stepId", route({ params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps" }) }, async ({ params, member, organization, res }) => {
  throw new Error("Not implemented")
}))

templateDraftsRouter.delete("/:id/draft/steps/:stepId", route({ params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps" }) }, async ({ params, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  await db.transaction(async (tx) => {
    const draft = await ensureDraft(tx, { member, organization }, params.id)

    // TODO: Close the gap in positions

    const deletedIds = await tx.delete(templateSteps).where(and(eq(templateSteps.templateVersionId, draft.id), eq(templateSteps.id, params.stepId))).returning({ id: templateSteps.id })
    if (deletedIds.length === 0) throw new HttpError("not_found", "Step not found")
  })

  res.status(204).send()
}))
