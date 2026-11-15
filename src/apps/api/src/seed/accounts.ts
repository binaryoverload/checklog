import { and, eq } from "drizzle-orm"

import { auth } from "@/core/auth.ts"
import { logger } from "@/core/logger.ts"
import { members, organizations, users } from "@/db/auth-schema.ts"
import { db } from "@/db/index.ts"
import type { OrgRole } from "@checklog/shared/auth"
import { platformAdminRoleName } from "@checklog/shared/auth"

// Development sign-ins. Every seeded account shares this password.
const password = "checklog"

const platformAdmin = { name: "Platform Admin", email: "platform-admin@checklog.co.uk", role: platformAdminRoleName }

// One account per organization role, each a member of every seeded organization with that role
const organizationUsers: { name: string, email: string, organizationRole: OrgRole }[] = [
  { name: "Dev Owner", email: "owner@checklog.co.uk", organizationRole: "owner" },
  { name: "Dev Admin", email: "admin@checklog.co.uk", organizationRole: "admin" },
  { name: "Dev Editor", email: "editor@checklog.co.uk", organizationRole: "editor" },
  { name: "Dev Viewer", email: "viewer@checklog.co.uk", organizationRole: "viewer" },
]

// More than one, so there's always another organization to switch to
const seedOrganizations = [
  { name: "Acme", slug: "acme" },
  { name: "Globex", slug: "globex" },
]

export const signInEmails = [platformAdmin, ...organizationUsers].map(({ email }) => email)

// A seeded member of an organization, as the later seeds need them
export interface SeededMember {
  userId: string
  memberId: string
}

export interface SeededOrganization {
  id: string
  name: string
  members: Record<OrgRole, SeededMember>
}

// Users and organizations go through Better Auth so passwords are hashed and IDs are generated as usual.
// Roles are set directly, because Better Auth's set-role endpoint is refused for everyone.
async function findOrCreateUser({ name, email, role }: { name: string, email: string, role: string }) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
  const userId = existing?.id ?? (await auth.api.signUpEmail({ body: { name, email, password } })).user.id
  if (!existing) logger.info(`Seeded user ${email}`)

  await db.update(users).set({ role }).where(eq(users.id, userId))
  return userId
}

// Creating an organization through Better Auth also makes its creator the owner
async function findOrCreateOrganization({ name, slug }: { name: string, slug: string }, ownerId: string) {
  const existing = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) })
  if (existing) return existing.id

  const organization = await auth.api.createOrganization({ body: { name, slug, userId: ownerId } })
  logger.info(`Seeded organization ${name}`)
  return organization.id
}

// Adds a missing membership through Better Auth, and puts back a role that was changed since
async function ensureMembership(organizationId: string, userId: string, role: OrgRole): Promise<string> {
  const membership = await db.query.members.findFirst({ where: and(eq(members.userId, userId), eq(members.organizationId, organizationId)) })
  if (!membership) {
    const added = await auth.api.addMember({ body: { organizationId, userId, role } })
    return added!.id
  }
  if (membership.role !== role) {
    await db.update(members).set({ role }).where(eq(members.id, membership.id))
  }
  return membership.id
}

export async function seedAccounts(): Promise<SeededOrganization[]> {
  await findOrCreateUser(platformAdmin)

  const seededUsers = []
  for (const { organizationRole, ...user } of organizationUsers) {
    seededUsers.push({ userId: await findOrCreateUser({ ...user, role: "user" }), organizationRole })
  }
  const ownerId = seededUsers.find(({ organizationRole }) => organizationRole === "owner")!.userId

  const seeded: SeededOrganization[] = []
  for (const seedOrganization of seedOrganizations) {
    const organizationId = await findOrCreateOrganization(seedOrganization, ownerId)
    const organizationMembers = {} as Record<OrgRole, SeededMember>
    for (const { userId, organizationRole } of seededUsers) {
      organizationMembers[organizationRole] = { userId, memberId: await ensureMembership(organizationId, userId, organizationRole) }
    }
    seeded.push({ id: organizationId, name: seedOrganization.name, members: organizationMembers })
  }
  return seeded
}
