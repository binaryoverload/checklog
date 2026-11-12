import { and, eq, sql, gt, gte } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { sortBy } from "es-toolkit"
import { Router } from "express"

import { assertTemplateAccessLevel, visibleTemplatesWhere } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { templateFields, templates, templateSteps, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toTemplateStepDto, toTemplateVersionDto, toTemplateVersionWithStepsDto } from "@/mappers/templates.ts"
import { assertAssigneeValid } from "@/services/assignees.ts"
import { ensureDraft, requireDraft } from "@/services/templates.ts"
import { templateStepCreateBodySchema, templateStepOrderBodySchema, templateStepUpdateBodySchema } from "@checklog/shared/api"
import { assigneeToFlat, flatToAssignee, templateStepRuleIssues, templateVersionPublishIssues } from "@checklog/shared/domain"
import { diffArrays, typeIdParamSchema, typeIdParamsSchema } from "@checklog/shared/utils"

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
  if (!row.draft) {
    res.json({ draftVersion: null })
    return
  }

  const [steps, fields] = await Promise.all([
    db.select().from(templateSteps).where(eq(templateSteps.templateVersionId, row.draft.id)),
    db.select().from(templateFields).where(eq(templateFields.templateVersionId, row.draft.id)),
  ])

  res.json({
    draftVersion: toTemplateVersionWithStepsDto(row.draft, steps, fields),
  })
}))

templateDraftsRouter.post("/:id/draft", route({ params: typeIdParamSchema("templates") }, async ({ params, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  const [draft, steps, fields] = await db.transaction(async (tx) => {
    const draft = await ensureDraft(tx, { member, organization }, params.id)

    const steps = await tx.select().from(templateSteps).where(eq(templateSteps.templateVersionId, draft.id))
    const fields = await tx.select().from(templateFields).where(eq(templateFields.templateVersionId, draft.id))

    return [draft, steps, fields]
  })

  res.json({
    draftVersion: toTemplateVersionWithStepsDto(draft, steps, fields),
  })
}))

templateDraftsRouter.delete("/:id/draft", route({ params: typeIdParamSchema("templates") }, async ({ params, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  await db.transaction(async (tx) => {
    const draft = await requireDraft(tx, { member, organization }, params.id)

    if (draft.version === 1) throw new HttpError("conflict", "Cannot delete the first version of a template")

    await tx.delete(templateVersions).where(eq(templateVersions.id, draft.id))
  })

  res.sendStatus(204)
}))

templateDraftsRouter.post("/:id/draft/publish", route({ params: typeIdParamSchema("templates") }, async ({ params, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  const publishedVersion = await db.transaction(async (tx) => {
    const draft = await requireDraft(tx, { member, organization }, params.id)

    const steps = (await tx.select().from(templateSteps).where(eq(templateSteps.templateVersionId, draft.id))).map(row => ({ ...row, assignee: flatToAssignee(row) }))
    const fields = (await tx.select().from(templateFields).where(eq(templateFields.templateVersionId, draft.id)))

    const publishIssues = templateVersionPublishIssues(draft.id, steps, fields)

    if (publishIssues.length > 0) throw new HttpError(
      "precondition_failed",
      "Cannot publish template due to precondition issues",
      publishIssues,
    )

    const [publishedVersion] = await tx.update(templateVersions)
      .set({
        publishedAt: sql`now()`,
        publishedBy: member.userId,
        status: "published",
      })
      .where(eq(templateVersions.id, draft.id))
      .returning()
    if (!publishedVersion) throw new HttpError("internal", "Failed to publish template version")

    await tx.update(templates)
      .set({ currentVersionId: publishedVersion.id })
      .where(eq(templates.id, draft.templateId))

    return publishedVersion
  })

  res.json(toTemplateVersionDto(publishedVersion))
}))

templateDraftsRouter.post("/:id/draft/steps", route({ params: typeIdParamSchema("templates"), body: templateStepCreateBodySchema }, async ({ params, body, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")
  await assertAssigneeValid(db, body.assignee, organization.id)

  const step = await db.transaction(async (tx) => {
    const draft = await requireDraft(tx, { member, organization }, params.id)

    const nextPosition = await tx.select({ maxPosition: sql<number>`max(${templateSteps.position})` })
      .from(templateSteps)
      .where(eq(templateSteps.templateVersionId, draft.id))
      .then(([row]) => (row?.maxPosition ?? -1) + 1)

    const { assignee, position: requestedPosition, ...fields } = body

    const position = Math.min(requestedPosition ?? nextPosition, nextPosition)

    if (requestedPosition !== undefined && position < nextPosition) {
      await tx.update(templateSteps)
        .set({ position: sql`${templateSteps.position} + 1` })
        .where(and(eq(templateSteps.templateVersionId, draft.id), gte(templateSteps.position, requestedPosition)))
    }

    const [step] = await tx.insert(templateSteps)
      .values({
        ...fields,
        organizationId: organization.id,
        templateVersionId: draft.id,
        position,
        createdBy: member.userId,
        ...assigneeToFlat(assignee ?? null),
      }).returning()
    if (!step) throw new HttpError("internal", "Failed to create template step")

    return step
  })

  res.json(toTemplateStepDto(step))
}))

templateDraftsRouter.put("/:id/draft/steps/order", route({
  params: typeIdParamSchema("templates"),
  body: templateStepOrderBodySchema,
}, async ({ params, body, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  const steps = await db.transaction(async (tx) => {
    const draft = await requireDraft(tx, { member, organization }, params.id)
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

templateDraftsRouter.patch("/:id/draft/steps/:stepId", route({
  params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps" }),
  body: templateStepUpdateBodySchema,
}, async ({ params, body, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")
  await assertAssigneeValid(db, body.assignee, organization.id)

  const step = await db.transaction(async (tx) => {
    const draft = await requireDraft(tx, { member, organization }, params.id)

    const [existingStep] = await tx.select().from(templateSteps).where(and(eq(templateSteps.templateVersionId, draft.id), eq(templateSteps.id, params.stepId)))
    if (!existingStep) {
      throw new HttpError("not_found", "Step not found")
    }

    const { updatedAt, assignee, ...updateData } = body

    if (new Date(updatedAt).getTime() !== existingStep.updatedAt.getTime()) {
      throw new HttpError("conflict", "This step was changed after you loaded it. Reload it and try again.")
    }

    const merged = {
      kind: updateData.kind ?? existingStep.kind,
      isHalt: updateData.isHalt ?? existingStep.isHalt,
      skippable: updateData.skippable ?? existingStep.skippable,
      assignee: assignee !== undefined ? assignee : flatToAssignee(existingStep),
    }

    const issues = templateStepRuleIssues(merged)
    if (issues.length > 0) {
      throw new HttpError("validation_failed", "The request is invalid", issues.map(issue => ({ location: "body", ...issue })))
    }

    const [step] = await tx.update(templateSteps)
      .set({
        ...updateData,
        ...(assignee !== undefined ? assigneeToFlat(assignee) : {}),
      })
      .where(and(eq(templateSteps.templateVersionId, draft.id), eq(templateSteps.id, params.stepId)))
      .returning()
    if (!step) throw new HttpError("internal", "Failed to update step")

    return step
  })

  res.json(toTemplateStepDto(step))
}))

templateDraftsRouter.delete("/:id/draft/steps/:stepId", route({ params: typeIdParamsSchema({ id: "templates", stepId: "templateSteps" }) }, async ({ params, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  await db.transaction(async (tx) => {
    const draft = await requireDraft(tx, { member, organization }, params.id)

    const [deleted] = await tx.delete(templateSteps)
      .where(and(eq(templateSteps.templateVersionId, draft.id), eq(templateSteps.id, params.stepId)))
      .returning({ position: templateSteps.position })
    if (!deleted) throw new HttpError("not_found", "Step not found")

    await tx.update(templateSteps)
      .set({ position: sql`${templateSteps.position} - 1` })
      .where(and(eq(templateSteps.templateVersionId, draft.id), gt(templateSteps.position, deleted.position)))
  })

  res.sendStatus(204)
}))
