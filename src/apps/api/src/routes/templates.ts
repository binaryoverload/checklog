import { and, asc, count, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Router } from "express"
import z from "zod"

import { assertCan, templateAccessLevel, visibleTemplatesWhere } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { schedules, templates, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toTemplateDto, toTemplateVersionDto } from "@/mappers/templates.ts"
import { isUniqueViolation } from "@/util/db.ts"
import { cursorCondition, orderFor, toPage } from "@/util/pagination.ts"
import type { SortDefinition } from "@/util/pagination.ts"
import type { Template } from "@/util/types.ts"
import { createTemplateBodySchema, paginationQuerySchema, updateTemplateBodySchema } from "@checklog/shared/api"
import { templateStatusSchema } from "@checklog/shared/domain"
import { typeIdParamsSchema } from "@checklog/shared/utils"

export const templatesRouter = Router()

templatesRouter.post("/", route({ body: createTemplateBodySchema }, async ({ body, member, res }) => {
  assertCan(member, { template: ["create"] })

  try {
    const result = await db.transaction(async (tx) => {
      const templateRows = await tx.insert(templates).values({
        name: body.name,
        description: body.description,
        createdBy: member.userId,
        organizationId: member.organizationId,
      }).returning()
      const template = templateRows[0]!
      await tx.insert(templateVersions).values({
        templateId: template.id,
        version: 1,
        status: "draft",
        createdBy: member.userId,
        organizationId: member.organizationId,
      })
      return template
    })

    res.status(200).json(toTemplateDto(result))
  } catch (error) {
    if (isUniqueViolation(error, "templates_name_unique_idx")) {
      throw new HttpError("validation_failed", "Template name must be unique", [{ location: "body", path: ["name"], message: "Template name must be unique" }])
    }
    throw error
  }
}))

const templateSort: SortDefinition<Template> = {
  key: "name",
  direction: "asc",
  column: templates.name,
  sortValue: row => row.name,
  idColumn: templates.id,
  idOf: row => row.id,
}

templatesRouter.get("/", route({ query: paginationQuerySchema().and(z.object({ status: templateStatusSchema.default("active") })) }, async ({ query, member, organization, res }) => {
  const visible = visibleTemplatesWhere({ member, organization }, "view")

  const [rows, [counted]] = await Promise.all([
    db.select().from(templates)
      .where(and(eq(templates.status, query.status), visible, cursorCondition(templateSort, query.cursor)))
      .orderBy(asc(templates.status), ...orderFor(templateSort))
      .limit(query.limit + 1),
    db.select({ total: count() }).from(templates).where(and(eq(templates.status, query.status), visible)),
  ])

  res.status(200).json(toPage(rows, { limit: query.limit, total: counted!.total, sort: templateSort, map: toTemplateDto }))
}))

const currentVersion = alias(templateVersions, "current_version")
const draft = alias(templateVersions, "draft")

templatesRouter.get("/:id", route({ params: typeIdParamsSchema("templates") }, async ({ params, member, organization, res }) => {
  const visible = visibleTemplatesWhere({ member, organization }, "view")

  const [row] = await db
    .select({ template: templates, currentVersion, draft })
    .from(templates)
    .leftJoin(currentVersion, eq(currentVersion.id, templates.currentVersionId))
    .leftJoin(draft, and(eq(draft.templateId, templates.id), eq(draft.status, "draft")))
    .where(and(eq(templates.id, params.id), visible))

  if (!row) throw new HttpError("not_found", "Template not found")

  res.json({
    ...toTemplateDto(row.template),
    currentVersion: row.currentVersion ? toTemplateVersionDto(row.currentVersion) : null,
    draftVersion: row.draft ? toTemplateVersionDto(row.draft) : null,
  })
}))

templatesRouter.patch("/:id", route({ params: typeIdParamsSchema("templates"), body: updateTemplateBodySchema }, async ({ params, body, member, organization, res }) => {
  const visible = visibleTemplatesWhere({ member, organization }, "edit")

  try {
    const [updated] = await db.update(templates)
      .set({
        name: body.name,
        description: body.description,
      })
      .where(and(eq(templates.id, params.id), visible))
      .returning()

    if (!updated) {
      const level = await templateAccessLevel(db, { member, organization }, params.id)
      if (!level) throw new HttpError("not_found", "Template not found")
      throw new HttpError("forbidden", "You need edit access to this template")
    }

    res.status(200).json(toTemplateDto(updated))
  } catch (error) {
    if (isUniqueViolation(error, "templates_name_unique_idx")) {
      throw new HttpError("validation_failed", "Template name must be unique", [{ location: "body", path: ["name"], message: "Template name must be unique" }])
    }
    throw error
  }
}))

templatesRouter.post("/:id/archive", route({ params: typeIdParamsSchema("templates"), impersonation: "refuse" }, async ({ params, member, organization, res }) => {
  const visible = visibleTemplatesWhere({ member, organization }, "edit")

  const archived = await db.transaction(async (tx) => {
    const [template] = await tx.update(templates)
      .set({ status: "archived" })
      .where(and(eq(templates.id, params.id), eq(templates.status, "active"), visible))
      .returning()
    if (!template) return null

    // TODO: record schedule.archived for each returned schedule
    await tx.update(schedules)
      .set({ status: "archived" })
      .where(and(eq(schedules.templateId, template.id), inArray(schedules.status, ["active", "paused"])))
      .returning()

    return template
  })

  if (!archived) {
    const level = await templateAccessLevel(db, { member, organization }, params.id)
    if (!level) throw new HttpError("not_found", "Template not found")
    if (level !== "edit") throw new HttpError("forbidden", "You need edit access to this template")
    throw new HttpError("conflict", "Template is already archived")
  }

  res.json(toTemplateDto(archived))
}))

templatesRouter.post("/:id/restore", route({ params: typeIdParamsSchema("templates"), impersonation: "refuse" }, async ({ params, member, organization, res }) => {
  const visible = visibleTemplatesWhere({ member, organization }, "edit")

  try {
    const [updated] = await db.update(templates)
      .set({
        status: "active",
      })
      .where(and(eq(templates.id, params.id), eq(templates.status, "archived"), visible))
      .returning()

    if (!updated) {
      const level = await templateAccessLevel(db, { member, organization }, params.id)
      if (!level) throw new HttpError("not_found", "Template not found")
      if (level !== "edit") throw new HttpError("forbidden", "You need edit access to this template")
      throw new HttpError("conflict", "Template is not archived")
    }

    res.status(200).json(toTemplateDto(updated))
  } catch (error) {
    if (isUniqueViolation(error, "templates_name_unique_idx")) {
      throw new HttpError("conflict", "An active template already uses this name; rename one of them first")
    }
    throw error
  }
}))
