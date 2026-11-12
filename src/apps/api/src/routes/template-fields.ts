import { and, eq, gt, sql } from "drizzle-orm"
import { sortBy } from "es-toolkit"
import { Router } from "express"

import { assertTemplateAccessLevel } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { templateFields, templateSteps } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toTemplateFieldDto } from "@/mappers/templates.ts"
import { requireDraft } from "@/services/templates.ts"
import { isUniqueViolation } from "@/util/db.ts"
import { templateFieldCreateBodySchema, templateFieldOrderBodySchema, templateFieldUpdateBodySchema } from "@checklog/shared/api"
import { diffArrays, typeIdParamsSchema } from "@checklog/shared/utils"

export const templateFieldsRouter = Router()

templateFieldsRouter.post("/:id/draft/steps/:stepId/fields", route({ body: templateFieldCreateBodySchema, params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps" }) }, async ({
  body, params, member, organization, res,
}) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  const field = await db.transaction(async (tx) => {
    const draft = await requireDraft(tx, { member, organization }, params.id)

    const [step] = await tx.select({ id: templateSteps.id }).from(templateSteps)
      .where(and(
        eq(templateSteps.templateVersionId, draft.id),
        eq(templateSteps.id, params.stepId),
      ))
    if (!step) throw new HttpError("not_found", "Step not found")

    const nextPosition = await tx.select({ maxPosition: sql<number>`max(${templateFields.position})` })
      .from(templateFields)
      .where(eq(templateFields.templateStepId, step.id))
      .then(([row]) => (row?.maxPosition ?? -1) + 1)

    try {
      const [field] = await tx.insert(templateFields)
        .values({
          label: body.label,
          key: body.key,
          position: nextPosition,
          helpText: body.helpText,
          required: body.required,
          type: body.options.type,
          options: body.options,
          organizationId: organization.id,
          templateVersionId: draft.id,
          templateStepId: step.id,
          createdBy: member.userId,
        }).returning()
      if (!field) throw new HttpError("internal", "Failed to create the field")

      return field
    } catch (e) {
      if (isUniqueViolation(e, "template_fields_template_version_id_key_unique")) {
        throw new HttpError("conflict", "Another field in this template already uses that key")
      }
      throw e
    }
  })

  res.json(toTemplateFieldDto(field))
}))

templateFieldsRouter.patch("/:id/draft/steps/:stepId/fields/:fieldId", route({ body: templateFieldUpdateBodySchema, params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps", fieldId: "templateFields" }) }, async ({ body, params, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  const field = await db.transaction(async (tx) => {
    const draft = await requireDraft(tx, { member, organization }, params.id)

    const [field] = await tx.select().from(templateFields).where(and(
      eq(templateFields.templateVersionId, draft.id),
      eq(templateFields.templateStepId, params.stepId),
      eq(templateFields.id, params.fieldId),
    ))
    if (!field) throw new HttpError("not_found", "Field not found")

    if (new Date(body.updatedAt).getTime() !== field.updatedAt.getTime()) {
      throw new HttpError("conflict", "This field was changed after you loaded it. Reload it and try again.")
    }

    try {
      const [updatedField] = await tx.update(templateFields)
        .set({
          label: body.label,
          key: body.key,
          helpText: body.helpText,
          required: body.required,
          type: body.options?.type,
          options: body.options,
        })
        .where(eq(templateFields.id, params.fieldId))
        .returning()
      if (!updatedField) throw new HttpError("internal", "Failed to update the field")

      return updatedField
    } catch (e) {
      if (isUniqueViolation(e, "template_fields_template_version_id_key_unique")) {
        throw new HttpError("conflict", "Another field in this template already uses that key")
      }
      throw e
    }
  })

  res.json(toTemplateFieldDto(field))
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
