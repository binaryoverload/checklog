import { readFile } from "fs/promises"

import { sql } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"

import { config } from "@/core/config.ts"
import { logger } from "@/core/logger.ts"

import * as authSchema from "./auth-schema.ts"
import * as appSchema from "./schema.ts"

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL })

export const db = drizzle(pool, {
  schema: {
    ...appSchema,
    ...authSchema,
  },
})

const ADVISORY_LOCK_ID = 1000

export async function migrateDB() {
  const connection = await pool.connect()

  const journal = JSON.parse(await readFile("./drizzle/meta/_journal.json", "utf8")) as {
    entries: { tag: string, when: number }[]
  }

  logger.info("Starting database migration")

  try {
    await connection.query(
      `SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`,
    )

    await connection.query(`CREATE SCHEMA IF NOT EXISTS drizzle`)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)

    const { rows: [appliedRow] } = await connection.query<{ applied: string[] }>(`
      SELECT coalesce(array_agg(hash ORDER BY created_at), '{}') AS applied
      FROM drizzle.__drizzle_migrations
    `)
    const appliedHashes = new Set(appliedRow?.applied)
    const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" })

    logger.info(`Applying migrations (${migrations.length - appliedHashes.size} to apply, ${appliedHashes.size} already applied)`)

    let appliedCount = 0
    for (const [index, migration] of migrations.entries()) {
      const journalEntry = journal.entries[index]
      if (!journalEntry) {
        throw new Error(`Could not find matching journal entry for migration ${index}`)
      }

      if (appliedHashes.has(migration.hash)) continue

      logger.info(`Applying migration ${journalEntry.tag} (${++appliedCount}/${migrations.length - appliedHashes.size})`)
      await db.transaction(async (tx) => {
        for (const statement of migration.sql) await tx.execute(sql.raw(statement))
        await tx.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`)
      })
    }
    logger.info(`Database migration completed, ${appliedCount} migrations applied`)
  } catch (error) {
    logger.error("Migration failed", error)
    throw error
  } finally {
    await connection.query(
      `SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`,
    )
    connection.release()
  }
}
