import { and, eq } from "drizzle-orm"

import { logger } from "@/core/logger.ts"
import { db } from "@/db/index.ts"
import { schedules, templates } from "@/db/schema.ts"
import type { SeededOrganization } from "@/seed/accounts.ts"
import { recurrenceToRRule } from "@/util/rrule.ts"
import type { ScheduleRecurrence, ScheduleStatus } from "@checklog/shared/domain"

interface SeedSchedule {
  template: string
  recurrence: Omit<ScheduleRecurrence, "startDate" | "interval"> & { interval?: number }
  timezone: string
  runNamePattern: string
  status: ScheduleStatus
  // Due as soon as the seed finishes, at its most recent occurrence, so the worker's next tick queues a run for it
  dueNow?: boolean
}

export const scheduleDefinitions: SeedSchedule[] = [
  {
    // Hourly, so a running worker keeps queueing runs while you work
    template: "Fridge temperature log",
    recurrence: { frequency: "hourly", time: "00:00" },
    timezone: "Europe/London",
    runNamePattern: "Fridge check {date} {time}",
    status: "active",
    dueNow: true,
  },
  {
    template: "Weekly server checks",
    recurrence: { frequency: "weekly", weekdays: ["monday"], time: "09:00" },
    timezone: "Europe/London",
    runNamePattern: "Server checks, week {week}",
    status: "active",
    dueNow: true,
  },
  {
    template: "Fire alarm test",
    recurrence: { frequency: "daily", time: "08:30" },
    timezone: "America/New_York",
    runNamePattern: "{template} - {date}",
    status: "active",
  },
  {
    template: "Fire alarm test",
    recurrence: { frequency: "monthly", time: "10:00" },
    timezone: "Europe/London",
    runNamePattern: "Monthly fire drill {date}",
    status: "paused",
  },
  {
    template: "Weekly server checks",
    recurrence: { frequency: "daily", time: "07:00" },
    timezone: "Europe/London",
    runNamePattern: "Daily server checks {date}",
    status: "archived",
  },
]

// Seeds each schedule the template doesn't already have, matched by run name pattern
export async function seedSchedules(organization: SeededOrganization) {
  // Started a month ago, so a schedule that's due now has a real occurrence behind it
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  for (const definition of scheduleDefinitions) {
    const [template] = await db.select().from(templates)
      .where(and(eq(templates.organizationId, organization.id), eq(templates.name, definition.template)))
    if (!template) throw new Error(`Seed schedule needs the template ${definition.template}`)

    const existing = await db.query.schedules.findFirst({
      where: and(eq(schedules.templateId, template.id), eq(schedules.runNamePattern, definition.runNamePattern)),
    })
    if (existing) continue

    const rule = recurrenceToRRule({ interval: 1, startDate, ...definition.recurrence }, definition.timezone)
    const occurrence = definition.dueNow ? rule.previous(new Date()) : rule.next(new Date())
    const nextRunAt = definition.status === "active" && occurrence ? new Date(occurrence.epochMilliseconds) : null

    await db.insert(schedules).values({
      organizationId: organization.id,
      templateId: template.id,
      status: definition.status,
      rrule: rule.toString(),
      timezone: definition.timezone,
      nextRunAt,
      runNamePattern: definition.runNamePattern,
      createdBy: organization.members.owner.userId,
    })
    logger.info(`Seeded schedule ${definition.runNamePattern} in ${organization.name}`)
  }
}
