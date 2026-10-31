import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { config } from "../config.ts"
import * as appSchema from "./schema.ts"
import * as authSchema from "./auth-schema.ts"

export const pool = new pg.Pool({ connectionString: config.databaseUrl })

export const db = drizzle(pool, {
  schema: {
    ...appSchema,
    ...authSchema,
  },
})

const ADVISORY_LOCK_ID = 1000

export async function migrateDB() {
  const connection = await pool.connect()
  try {
    await connection.query(
      `SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`,
    )

    await migrate(db, { migrationsFolder: "./drizzle" })
  } finally {
    await connection.query(
      `SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`,
    )
    connection.release()
  }
}
