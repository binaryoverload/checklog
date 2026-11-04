import type { SQL } from "drizzle-orm"
import { and, eq, exists, inArray, or, sql } from "drizzle-orm"

import { teamMembers, teams } from "@/db/auth-schema.ts"
import { db } from "@/db/index.ts"
import { templateAccess, templates } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import type { Database, Member, PermissionContext, User } from "@/util/types.ts"
import { highestTemplateAccessLevel, orgRoles, platformRoles, templateAccessIncludes, templateAccessLevels } from "@checklog/shared"
import type { OrgStatementsCheckInput, PlatformStatementsCheckInput, TemplateAccessLevel } from "@checklog/shared"

export function can(member: Member, permissions: OrgStatementsCheckInput): boolean {
  const roles = member.role.split(",").map(role => role.trim())

  return roles.some((roleName) => {
    if (!Object.hasOwn(orgRoles, roleName)) return false

    const role = orgRoles[roleName as keyof typeof orgRoles]

    return role.authorize(permissions).success
  })
}

export function assertCan(member: Member, permissions: OrgStatementsCheckInput): void {
  if (!can(member, permissions)) {
    throw new HttpError("forbidden", "You do not have permission to perform this action")
  }
}

export function platformCan(user: User, permissions: PlatformStatementsCheckInput): boolean {
  const roles = (user.role ?? "").split(",").map(role => role.trim())

  return roles.some((roleName) => {
    if (!Object.hasOwn(platformRoles, roleName)) return false

    const role = platformRoles[roleName as keyof typeof platformRoles]

    return role.authorize(permissions).success
  })
}

export function assertPlatformCan(user: User, permissions: PlatformStatementsCheckInput): void {
  if (!platformCan(user, permissions)) {
    throw new HttpError("forbidden", "You do not have permission to perform this action")
  }
}

// SQL builder to determine which template access grants apply to this member
function grantAppliesTo({ organization, member }: PermissionContext): SQL {
  const memberTeamIds = db
    .select({ id: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, member.userId), eq(teams.organizationId, organization.id)))

  return or(eq(templateAccess.memberId, member.id), inArray(templateAccess.teamId, memberTeamIds))!
}

// Condition for queries on templates: the ones this member can reach at the needed level
export function visibleTemplatesWhere(context: PermissionContext, needs: TemplateAccessLevel = "view"): SQL {
  if (context.organization.deletedAt) return sql`false`

  const isInOrg = eq(templates.organizationId, context.organization.id)
  if (can(context.member, { template: ["manage"] })) return isInOrg

  const grantedLevels = templateAccessLevels.slice(templateAccessLevels.indexOf(needs))
  const hasGrant = exists(
    db.select({ one: sql`1` })
      .from(templateAccess)
      .where(and(
        eq(templateAccess.templateId, templates.id),
        inArray(templateAccess.level, grantedLevels),
        grantAppliesTo(context),
      )),
  )

  return and(isInOrg, or(eq(templates.createdBy, context.member.userId), hasGrant))!
}

export async function templateAccessLevel(
  tx: Database,
  { organization, member }: PermissionContext,
  templateId: string,
): Promise<TemplateAccessLevel | null> {
  // Backstop for callers that don't go through route(), which already refuses deleted organizations
  if (organization.deletedAt) return null

  const template = await tx.query.templates.findFirst({
    where: (t, { and, eq }) => and(eq(t.id, templateId), eq(t.organizationId, organization.id)),
  })

  // Either the template does not exist or it's from a different organization
  if (!template) return null

  if (can(member, { template: ["manage"] })) return "edit"
  if (template.createdBy === member.userId) return "edit"

  const grants = await tx
    .select({ level: templateAccess.level })
    .from(templateAccess)
    .where(and(eq(templateAccess.templateId, templateId), grantAppliesTo({ organization, member })))

  return highestTemplateAccessLevel(grants.map(grant => grant.level))
}

export async function assertTemplateAccessLevel(
  tx: Database,
  context: PermissionContext,
  templateId: string,
  requiredLevel: TemplateAccessLevel,
): Promise<void> {
  const level = await templateAccessLevel(tx, context, templateId)

  if (level === null) throw new HttpError("not_found", "Template not found")

  if (!templateAccessIncludes(level, requiredLevel)) {
    throw new HttpError("forbidden", "You do not have permission to perform this action")
  }
}
