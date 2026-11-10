import { and, asc, eq } from "drizzle-orm"
import { Router } from "express"

import { assertTemplateAccessLevel } from "@/core/permissions.ts"
import { members, teams, users } from "@/db/auth-schema.ts"
import { db } from "@/db/index.ts"
import { templateAccess } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toTemplateAccessDto, toTemplateAccessWithNameDto } from "@/mappers/templates.ts"
import { templateAccessUpsertBodySchema } from "@checklog/shared/api"
import { typeIdParamSchema, typeIdParamsSchema } from "@checklog/shared/utils"

export const templateAccessRouter = Router()

templateAccessRouter.get("/:id/access", route({ params: typeIdParamSchema("templates") }, async ({ params, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  const grants = await db.select({ templateAccess, memberName: users.name, teamName: teams.name }).from(templateAccess)
    .leftJoin(members, eq(members.id, templateAccess.memberId))
    .leftJoin(users, eq(users.id, members.userId))
    .leftJoin(teams, eq(teams.id, templateAccess.teamId))
    .where(eq(templateAccess.templateId, params.id))
    .orderBy(asc(templateAccess.id))

  const grantsWithName = grants.map((g) => {
    const name = g.memberName ?? g.teamName ?? "Unknown"
    return toTemplateAccessWithNameDto(g.templateAccess, name)
  })

  res.json(grantsWithName)
}))

templateAccessRouter.delete("/:id/access/:accessId", route({ params: typeIdParamsSchema({ id: "templates", accessId: "templateAccess" }), impersonation: "refuse" }, async ({ params, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  const deleted = await db.delete(templateAccess)
    .where(and(eq(templateAccess.templateId, params.id), eq(templateAccess.id, params.accessId)))
    .returning({ id: templateAccess.id })

  if (!deleted.length) throw new HttpError("not_found", "Access not found")

  res.sendStatus(204)
}))

templateAccessRouter.put("/:id/access", route({ params: typeIdParamSchema("templates"), body: templateAccessUpsertBodySchema, impersonation: "refuse" }, async ({ params, body, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, params.id, "edit")

  let grantee: { memberId: string, teamId: null } | { memberId: null, teamId: string }
  let constraintTarget: [typeof templateAccess.templateId, typeof templateAccess.memberId | typeof templateAccess.teamId]

  if ("memberId" in body) {
    const [found] = await db.select({ id: members.id }).from(members)
      .where(and(eq(members.id, body.memberId), eq(members.organizationId, organization.id)))
    if (!found) throw new HttpError("validation_failed", "The request is invalid", [{ location: "body", path: ["memberId"], message: "No member with this ID in the organization" }])

    grantee = { memberId: body.memberId, teamId: null }
    constraintTarget = [templateAccess.templateId, templateAccess.memberId]
  } else {
    const [found] = await db.select({ id: teams.id }).from(teams)
      .where(and(eq(teams.id, body.teamId), eq(teams.organizationId, organization.id)))
    if (!found) throw new HttpError("validation_failed", "The request is invalid", [{ location: "body", path: ["teamId"], message: "No team with this ID in the organization" }])

    grantee = { memberId: null, teamId: body.teamId }
    constraintTarget = [templateAccess.templateId, templateAccess.teamId]
  }

  const [access] = await db.insert(templateAccess)
    .values({ organizationId: organization.id, createdBy: member.userId, templateId: params.id, ...grantee, level: body.level })
    .onConflictDoUpdate({ target: constraintTarget, set: { level: body.level } })
    .returning()
  if (!access) throw new HttpError("internal", "Failed to save the grant")

  res.json(toTemplateAccessDto(access))
}))
