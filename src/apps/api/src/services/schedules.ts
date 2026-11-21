import { and, eq } from "drizzle-orm"

import { schedules } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import type { Database, UserContext } from "@/util/types.ts"

export async function lockSchedule(tx: Database, context: UserContext, scheduleId: string) {
  const [schedule] = await tx.select().from(schedules)
    .where(and(
      eq(schedules.id, scheduleId),
      eq(schedules.organizationId, context.organization.id),
    ))
    .for("update")
  if (!schedule) throw new HttpError("not_found", "Schedule not found")

  return schedule
}
