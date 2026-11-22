import { PgBoss } from "pg-boss"
import type { ConstructorOptions as BossOptions } from "pg-boss"

import { config } from "@/core/config.ts"
import { logger } from "@/core/logger.ts"

type Role = "api" | "worker"
export function createBoss(role: Role): PgBoss {
  const options: Record<Role, BossOptions> = {
    api: {
      supervise: false, // The worker does the maintenance operations
      schedule: false, // This API doesn't run any schedules
      max: 4, // API is only sending jobs, low concurrency
    },
    worker: {
      supervise: true, // Worker handles maintenance
      schedule: true, // Worker runs schedules
    },
  }

  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    application_name: `checklog-${role}`,

    ...options[role],
  })
  boss.on("error", error => logger.error("pg-boss error", error))
  return boss
}
