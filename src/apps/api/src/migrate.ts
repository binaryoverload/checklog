import { migrateDB, pool } from "@/db/index.ts"

await migrateDB()
await pool.end()
