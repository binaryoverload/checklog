import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { TestProject } from "vitest/node"

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string
  }
}

// One Postgres container for the whole run, migrated with the API's own runner, so tests see the real schema.
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer("postgres:18").start()
  const databaseUrl = container.getConnectionUri()

  // core/config.ts reads the environment when first imported, so set it before importing the database module
  Object.assign(process.env, project.config.env, { DATABASE_URL: databaseUrl })
  const { migrateDB, pool } = await import("@/db/index.ts")
  await migrateDB()
  await pool.end()

  project.provide("databaseUrl", databaseUrl)

  return async () => {
    await container.stop()
  }
}
