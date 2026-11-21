import type { SQL } from "drizzle-orm"
import { and, eq, exists, inArray, or, sql } from "drizzle-orm"

import { teamMembers, teams } from "@/db/auth-schema.ts"
import { db } from "@/db/index.ts"
import { runs, runSteps, templateAccess, templates, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import type { Database, Member, UserContext, User, RunStep } from "@/util/types.ts"
import { memberCan, memberRoles, platformRoles } from "@checklog/shared/auth"
import type { OrgStatementsCheckInput, PlatformStatementsCheckInput } from "@checklog/shared/auth"
import { highestTemplateAccessLevel, templateAccessIncludes, templateAccessLevels } from "@checklog/shared/domain"
import type { RunListScope, TemplateAccessLevel } from "@checklog/shared/domain"

export function assertCan(member: Member, permissions: OrgStatementsCheckInput): void {
  if (!memberCan(member, permissions)) {
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

export function memberTeamIdsQuery(tx: Database, { organization, member }: UserContext) {
  return tx
    .select({ id: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, member.userId), eq(teams.organizationId, organization.id)))
}

export async function getMemberTeamIds(tx: Database, context: UserContext) {
  const rows = await memberTeamIdsQuery(tx, context)
  return rows.map(r => r.id)
}

function grantAppliesTo({ organization, member }: UserContext): SQL {
  const memberTeamIds = memberTeamIdsQuery(db, { organization, member })

  return or(eq(templateAccess.memberId, member.id), inArray(templateAccess.teamId, memberTeamIds))!
}

// A grant on the template, at one of these levels, to the member or one of their groups
function hasTemplateGrant(context: UserContext, levels: readonly TemplateAccessLevel[]): SQL {
  return exists(
    db.select({ one: sql`1` })
      .from(templateAccess)
      .where(and(
        eq(templateAccess.templateId, templates.id),
        inArray(templateAccess.level, [...levels]),
        grantAppliesTo(context),
      )),
  )
}

export function visibleTemplatesWhere(context: UserContext, needs: TemplateAccessLevel = "view"): SQL {
  if (context.organization.deletedAt) return sql`false`

  const isInOrg = eq(templates.organizationId, context.organization.id)
  if (memberCan(context.member, { template: ["manage"] })) return isInOrg

  const grantedLevels = templateAccessLevels.slice(templateAccessLevels.indexOf(needs))
  return and(isInOrg, or(eq(templates.createdBy, context.member.userId), hasTemplateGrant(context, grantedLevels)))!
}

// The member's level on each template, for selects already limited by visibleTemplatesWhere(context, "view")
export function templateAccessLevelSql(context: UserContext): SQL<TemplateAccessLevel> {
  if (memberCan(context.member, { template: ["manage"] })) return sql<TemplateAccessLevel>`'edit'`

  return sql<TemplateAccessLevel>`case
    when ${templates.createdBy} = ${context.member.userId} then 'edit'
    when ${hasTemplateGrant(context, ["edit"])} then 'edit'
    when ${hasTemplateGrant(context, ["run"])} then 'run'
    else 'view'
  end`
}

/**
 * Returns SQL conditions for steps assigned to the member, their teams or roles.
 */
export function stepAssignedToQueries(context: UserContext) {
  return {
    member: and(eq(runSteps.assigneeType, "member"), eq(runSteps.assigneeMemberId, context.member.id))!,
    teams: and(eq(runSteps.assigneeType, "team"), inArray(runSteps.assigneeTeamId, memberTeamIdsQuery(db, context)))!,
    roles: and(eq(runSteps.assigneeType, "role"), inArray(runSteps.assigneeRole, memberRoles(context.member)))!,
  }
}

/**
 * Constructs the SQL for checking assigned steps - pass in conditions from `stepAssignedToQueries`
 */
function hasStepAssigned(...assignedTo: SQL[]): SQL {
  return exists(
    db.select({ one: sql`1` })
      .from(runSteps)
      .where(and(eq(runSteps.runId, runs.id), or(...assignedTo))),
  )
}

/**
 * Constructs the SQL for visible runs where the member:
 * - has the template:manage permissions
 * - can view the template
 * - has a step assigned to them (through member, team or role)
 * - started the run
 */
export function visibleRunsWhere(context: UserContext): SQL {
  if (context.organization.deletedAt) return sql`false`

  const isInOrg = eq(runs.organizationId, context.organization.id)
  if (memberCan(context.member, { template: ["manage"] })) return isInOrg

  const templateVisible = exists(
    db.select({ one: sql`1` })
      .from(templateVersions)
      .innerJoin(templates, eq(templates.id, templateVersions.templateId))
      .where(and(
        visibleTemplatesWhere(context, "view"),
        eq(runs.templateVersionId, templateVersions.id),
      )),
  )

  const { member, teams, roles } = stepAssignedToQueries(context)

  return and(
    isInOrg,
    or(templateVisible, hasStepAssigned(member, teams, roles), eq(runs.createdBy, context.member.userId)),
  )!
}

/**
 * Returns SQL to filter the role based on scope:
 * - "all" - returns `undefined` - no filtering
 * - "mine" - steps assigned to the member
 * - "groups" - steps assigned to teams or roles
 */
export function runScopeWhere(context: UserContext, scope: RunListScope): SQL | undefined {
  const { member, teams, roles } = stepAssignedToQueries(context)

  switch (scope) {
    case "all": return undefined
    case "mine": return hasStepAssigned(member)
    case "groups": return hasStepAssigned(teams, roles)
  }
}

type ActOnStepInput = Pick<RunStep, "assigneeType" | "assigneeMemberId" | "assigneeTeamId" | "assigneeRole">
export function canActOnStep(step: ActOnStepInput, member: Member, teamIds: string[], templateAccessLevel: TemplateAccessLevel | null) {
  const roles = memberRoles(member)

  switch (step.assigneeType) {
    case "member": return step.assigneeMemberId === member.id
    case "team": return step.assigneeTeamId != null && teamIds.includes(step.assigneeTeamId)
    case "role": return step.assigneeRole != null && roles.includes(step.assigneeRole)
    case null: return templateAccessLevel != null && templateAccessIncludes(templateAccessLevel, "run")
  }
}

export async function templateAccessLevel(
  tx: Database,
  { organization, member }: UserContext,
  templateId: string,
): Promise<TemplateAccessLevel | null> {
  // Backstop for callers that don't go through route(), which already refuses deleted organizations
  if (organization.deletedAt) return null

  const template = await tx.query.templates.findFirst({
    where: (t, { and, eq }) => and(eq(t.id, templateId), eq(t.organizationId, organization.id)),
  })

  // Either the template does not exist or it's from a different organization
  if (!template) return null

  if (memberCan(member, { template: ["manage"] })) return "edit"
  if (template.createdBy === member.userId) return "edit"

  const grants = await tx
    .select({ level: templateAccess.level })
    .from(templateAccess)
    .where(and(eq(templateAccess.templateId, templateId), grantAppliesTo({ organization, member })))

  return highestTemplateAccessLevel(grants.map(grant => grant.level))
}

export async function assertTemplateAccessLevel(
  tx: Database,
  context: UserContext,
  templateId: string,
  requiredLevel: TemplateAccessLevel,
): Promise<void> {
  const level = await templateAccessLevel(tx, context, templateId)

  if (level === null) throw new HttpError("not_found", "Template not found")

  if (!templateAccessIncludes(level, requiredLevel)) {
    throw new HttpError("forbidden", "You do not have permission to perform this action")
  }
}
