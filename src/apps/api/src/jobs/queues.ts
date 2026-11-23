import type { PgBoss, Queue } from "pg-boss"

import { logger } from "@/core/logger.ts"

// createQueue leaves an existing queue as it is, so updateQueue applies settings changed since. A policy can't change this way.
export async function ensureQueue(boss: PgBoss, name: string, { policy, ...options }: Omit<Queue, "name">) {
  logger.info(`Ensuring queue ${name}`)
  await boss.createQueue(name, { policy, ...options })
  if (Object.keys(options).length) await boss.updateQueue(name, options)
}
