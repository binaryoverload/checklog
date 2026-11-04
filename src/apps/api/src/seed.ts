import { and, eq } from "drizzle-orm"

import { auth } from "@/core/auth.ts"
import { logger } from "@/core/logger.ts"
import { members, organizations, users } from "@/db/auth-schema.ts"
import { db, pool } from "@/db/index.ts"
import { platformAdminRoleName } from "@checklog/shared"

// Development sign-ins. Every seeded account shares this password.
const password = "checklog"

const platformAdmin = { name: "Platform Admin", email: "admin@example.com", role: platformAdminRoleName }
const owner = { name: "Dev Owner", email: "owner@example.com", role: "user" }
const member = { name: "Dev Member", email: "member@example.com", role: "user" }

// Each gets the owner and member below, so there's always another organization to switch to
const seedOrganizations = [
  { name: "Acme", slug: "acme" },
  { name: "Globex", slug: "globex" },
]

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed a production database")
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

await findOrCreateUser(platformAdmin)
const ownerId = await findOrCreateUser(owner)
const memberId = await findOrCreateUser(member)

// Creating an organization through Better Auth also makes its creator the owner
async function findOrCreateOrganization({ name, slug }: { name: string, slug: string }, ownerId: string) {
  const existing = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) })
  if (existing) return existing.id

  const organization = await auth.api.createOrganization({ body: { name, slug, userId: ownerId } })
  logger.info(`Seeded organization ${name}`)
  return organization.id
}

// Adds a missing membership through Better Auth, and puts back a role that was changed since
async function ensureMembership(organizationId: string, userId: string, role: "owner" | "member") {
  logger.info(`Ensuring membership for user ${userId} as ${role} in organization ${organizationId}`)
  const membership = await db.query.members.findFirst({ where: and(eq(members.userId, userId), eq(members.organizationId, organizationId)) })
  if (!membership) {
    await auth.api.addMember({ body: { organizationId, userId, role } })
  } else if (membership.role !== role) {
    await db.update(members).set({ role }).where(eq(members.id, membership.id))
  }
}

for (const seedOrganization of seedOrganizations) {
  const organizationId = await findOrCreateOrganization(seedOrganization, ownerId)
  await ensureMembership(organizationId, ownerId, "owner")
  await ensureMembership(organizationId, memberId, "member")
}

logger.info(`Seed complete; sign in with ${platformAdmin.email}, ${owner.email} or ${member.email}`)
await pool.end()
