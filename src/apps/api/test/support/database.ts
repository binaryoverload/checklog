import { TransactionRollbackError } from "drizzle-orm"

import { members, organizations, teamMembers, teams, users } from "@/db/auth-schema.ts"
import { db } from "@/db/index.ts"
import { templateAccess, templates } from "@/db/schema.ts"
import type { Database, Member, Organization, PermissionContext } from "@/util/types.ts"
import type { OrgRole } from "@checklog/shared/auth"
import type { TemplateAccessLevel } from "@checklog/shared/domain"
import { typeIdForModel } from "@checklog/shared/utils"

// Runs a test body in a transaction that's always rolled back, so tests share one database without seeing each other's rows
export async function inRollback(body: (tx: Database) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await body(tx)
      tx.rollback()
    })
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error
  }
}

export async function createOrganization(tx: Database, name = "Test organization"): Promise<Organization> {
  const id = typeIdForModel("organization").toString()
  const [organization] = await tx.insert(organizations).values({ id, name, slug: id, createdAt: new Date() }).returning()
  return organization!
}

export async function createMember(tx: Database, organization: Organization, role: OrgRole | (string & {})): Promise<PermissionContext> {
  const userId = typeIdForModel("user").toString()
  await tx.insert(users).values({ id: userId, name: `Test ${role}`, email: `${userId}@example.com`, role: "user" })

  const [member] = await tx.insert(members).values({
    id: typeIdForModel("member").toString(),
    organizationId: organization.id,
    userId,
    role,
    createdAt: new Date(),
  }).returning()
  return { organization, member: member! }
}

export async function createGroup(tx: Database, organization: Organization, groupMembers: Member[] = []): Promise<string> {
  const teamId = typeIdForModel("team").toString()
  await tx.insert(teams).values({ id: teamId, name: "Test group", organizationId: organization.id, createdAt: new Date() })
  for (const member of groupMembers) await addToGroup(tx, teamId, member)
  return teamId
}

export async function addToGroup(tx: Database, teamId: string, member: Member): Promise<void> {
  await tx.insert(teamMembers).values({ id: typeIdForModel("teamMember").toString(), teamId, userId: member.userId, createdAt: new Date() })
}

// Names are unique within an organization
let templateCount = 0

export async function createTemplate(tx: Database, organization: Organization, createdBy = "user_someone_else"): Promise<string> {
  const [template] = await tx.insert(templates).values({ organizationId: organization.id, name: `Test template ${++templateCount}`, createdBy }).returning()
  return template!.id
}

export async function grant(
  tx: Database,
  templateId: string,
  to: { organization: Organization, memberId?: string, teamId?: string },
  level: TemplateAccessLevel,
): Promise<void> {
  await tx.insert(templateAccess).values({
    organizationId: to.organization.id,
    templateId,
    memberId: to.memberId,
    teamId: to.teamId,
    level,
    createdBy: "user_test",
  })
}
