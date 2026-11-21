// Development seed: sign-in accounts, organizations, groups, templates and runs. Run with pnpm db:seed.
// Every part skips what already exists, so it can be run again against a database that's been used.
import { logger } from "@/core/logger.ts"
import { pool } from "@/db/index.ts"
import { seedAccounts, signInEmails } from "@/seed/accounts.ts"
import { seedGroups } from "@/seed/groups.ts"
import { seedRuns } from "@/seed/runs.ts"
import { seedTemplates } from "@/seed/templates.ts"

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed a production database")
}

const organizations = await seedAccounts()
for (const organization of organizations) {
  const groups = await seedGroups(organization)
  await seedTemplates(organization, groups)
  await seedRuns(organization)
}

logger.info(`Seed complete; sign in with ${signInEmails.join(", ")}`)
await pool.end()
