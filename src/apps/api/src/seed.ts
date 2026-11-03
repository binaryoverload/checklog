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

const seedOrganization = { name: "Acme", slug: "acme" }

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

const existingOrganization = await db.query.organizations.findFirst({ where: eq(organizations.slug, seedOrganization.slug) })
const organizationId = existingOrganization?.id ?? (await auth.api.createOrganization({ body: { ...seedOrganization, userId: ownerId } })).id
if (!existingOrganization) logger.info(`Seeded organization ${seedOrganization.name}`)

// Adds a missing membership through Better Auth, and puts back a role that was changed since
async function ensureMembership(userId: string, role: "owner" | "member") {
  logger.info(`Ensuring membership for user ${userId} as ${role} in organization ${organizationId}`)
  const membership = await db.query.members.findFirst({ where: and(eq(members.userId, userId), eq(members.organizationId, organizationId)) })
  if (!membership) {
    await auth.api.addMember({ body: { organizationId, userId, role } })
  } else if (membership.role !== role) {
    await db.update(members).set({ role }).where(eq(members.id, membership.id))
  }
}

await ensureMembership(ownerId, "owner")
await ensureMembership(memberId, "member")

logger.info(`Seed complete; sign in with ${platformAdmin.email}, ${owner.email} or ${member.email}`)
await pool.end()
