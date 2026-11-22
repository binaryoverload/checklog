import type { PoolClient } from "pg"
import { PgBoss } from "pg-boss"
import type { ConstructorOptions as BossOptions, Db } from "pg-boss"

import { config } from "@/core/config.ts"
import { logger } from "@/core/logger.ts"
import type { Transaction } from "@/util/types.ts"

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
    instanceName: `checklog-${role}`,
    persistWarnings: true,
    persistQueueStats: true,
    warningRetentionDays: 60,
    ...options[role],
  })
  boss.on("error", error => logger.error("pg-boss error", error))
  return boss
}

export function bossDb(tx: Transaction): Db {
  const { client } = (tx as unknown as { session: { client: PoolClient } }).session
  return { executeSql: (text, values) => client.query(text, values) }
}
