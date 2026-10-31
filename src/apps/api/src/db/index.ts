import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { env } from "../env.ts"
import * as schema from "./schema.ts"

export const pool = new pg.Pool({ connectionString: env.databaseUrl })

export const db = drizzle(pool, { schema })
