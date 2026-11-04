import { afterAll, inject } from "vitest"

// Runs before each database test file imports anything, so core/config.ts picks up the container's URL
process.env.DATABASE_URL = inject("databaseUrl")

afterAll(async () => {
  const { pool } = await import("@/db/index.ts")
  await pool.end()
})
