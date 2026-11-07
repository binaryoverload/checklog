import { and, count, eq } from "drizzle-orm"
import { Router } from "express"

import { assertCan, visibleTemplatesWhere } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { templates, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toTemplateDto } from "@/mappers/templates.ts"
import { isUniqueViolation } from "@/util/db.ts"
import { cursorCondition, orderFor, toPage } from "@/util/pagination.ts"
import type { SortDefinition } from "@/util/pagination.ts"
import type { Template } from "@/util/types.ts"
import { createTemplateBodySchema, paginationQuerySchema, updateTemplateBodySchema } from "@checklog/shared/api"
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

templatesRouter.get("/", route({ query: paginationQuerySchema() }, async ({ query, member, organization, res }) => {
  const visible = visibleTemplatesWhere({ member, organization }, "view")

  const [rows, [counted]] = await Promise.all([
    db.select().from(templates)
      .where(and(visible, cursorCondition(templateSort, query.cursor)))
      .orderBy(...orderFor(templateSort))
      .limit(query.limit + 1),
    db.select({ total: count() }).from(templates).where(visible),
  ])

  res.status(200).json(toPage(rows, { limit: query.limit, total: counted!.total, sort: templateSort, map: toTemplateDto }))
}))

templatesRouter.get("/:id", route({ params: typeIdParamsSchema("templates") }, async ({ params, member, organization, res }) => {
  const visible = visibleTemplatesWhere({ member, organization }, "view")

  const template = await db.query.templates.findFirst({
    where: and(eq(templates.id, params.id), visible),
  })

  if (!template) throw new HttpError("not_found", "Template not found")

  res.status(200).json(toTemplateDto(template))
}))

templatesRouter.patch("/:id", route({ params: typeIdParamsSchema("templates"), body: updateTemplateBodySchema }, async ({ params, body, member, organization, res }) => {
  const visible = visibleTemplatesWhere({ member, organization }, "edit")

  try {
    const updated = await db.update(templates)
      .set({
        name: body.name,
        description: body.description,
      })
      .where(and(eq(templates.id, params.id), visible))
      .returning()

    if (updated.length === 0) throw new HttpError("not_found", "Template not found")

    res.status(200).json(toTemplateDto(updated[0]!))
  } catch (error) {
    if (isUniqueViolation(error, "templates_name_unique_idx")) {
      throw new HttpError("validation_failed", "Template name must be unique", [{ location: "body", path: ["name"], message: "Template name must be unique" }])
    }
    throw error
  }
}))
