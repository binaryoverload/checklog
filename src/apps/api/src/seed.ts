import { eq } from "drizzle-orm"

import { auth } from "@/core/auth.ts"
import { logger } from "@/core/logger.ts"
import { organizations, users } from "@/db/auth-schema.ts"
import { db, pool } from "@/db/index.ts"

// Development sign-ins. Every seeded account shares this password.
const password = "checklog-dev"

const owner = { name: "Dev Owner", email: "owner@example.com" }
const member = { name: "Dev Member", email: "member@example.com" }

const seedOrganization = { name: "Acme", slug: "acme" }

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed a production database")
}

// Users and organizations go through Better Auth so passwords are hashed and IDs are generated as usual.
async function findOrCreateUser({ name, email }: { name: string, email: string }) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (existing) return existing.id

  const { user } = await auth.api.signUpEmail({ body: { name, email, password } })
  logger.info(`Seeded user ${email}`)
  return user.id
}

const ownerId = await findOrCreateUser(owner)
const memberId = await findOrCreateUser(member)

const existingOrganization = await db.query.organizations.findFirst({ where: eq(organizations.slug, seedOrganization.slug) })

if (!existingOrganization) {
  const organization = await auth.api.createOrganization({ body: { ...seedOrganization, userId: ownerId } })
  await auth.api.addMember({ body: { organizationId: organization.id, userId: memberId, role: "member" } })
  logger.info(`Seeded organization ${seedOrganization.name}`)
}

logger.info(`Seed complete; sign in with ${owner.email} or ${member.email}`)
await pool.end()
