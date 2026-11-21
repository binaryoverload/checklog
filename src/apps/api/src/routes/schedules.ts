import { eq, and, asc } from "drizzle-orm"
import { Router } from "express"
import { RRuleTemporal } from "rrule-temporal"

import { assertTemplateAccessLevel } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { schedules } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toScheduleDto } from "@/mappers/schedules.ts"
import { lockSchedule } from "@/services/schedules.ts"
import { lockTemplate } from "@/services/templates.ts"
import { recurrenceToRRule, rruleToRecurrence } from "@/util/rrule.ts"
import { createScheduleSchema, listSchedulesQuerySchema, updateScheduleSchema } from "@checklog/shared/api"
import { typeIdParamsSchema } from "@checklog/shared/utils"

export const schedulesRouter = Router()

schedulesRouter.get("/", route({ query: listSchedulesQuerySchema }, async ({ query, member, organization, res }) => {
  await assertTemplateAccessLevel(db, { member, organization }, query.templateId, "view")

  const scheduleRows = await db.select().from(schedules)
    .where(and(
      eq(schedules.organizationId, organization.id),
      eq(schedules.templateId, query.templateId),
    ))
    .orderBy(asc(schedules.createdAt), asc(schedules.id))

  res.json(scheduleRows.map(toScheduleDto))
}))

schedulesRouter.post("/", route({
  body: createScheduleSchema,
}, async ({ body, member, organization, res }) => {
  const schedule = await db.transaction(async (tx) => {
    await assertTemplateAccessLevel(tx, { member, organization }, body.templateId, "edit")
    await lockTemplate(tx, { member, organization }, body.templateId)

    const rrule = recurrenceToRRule(body.recurrence, body.timezone)

    const nextRunAt = rrule.next()

    const [schedule] = await tx.insert(schedules).values({
      rrule: rrule.toString(),
      timezone: body.timezone,
      templateId: body.templateId,
      organizationId: organization.id,
      runNamePattern: body.runNamePattern,
      nextRunAt: nextRunAt ? new Date(nextRunAt.epochMilliseconds) : null,
      status: "active",
      createdBy: member.userId,
    }).returning()
    if (!schedule) throw new HttpError("internal", "Failed to create schedule")

    return schedule
  })

  res.json(toScheduleDto(schedule))
}))

schedulesRouter.patch("/:scheduleId", route({
  params: typeIdParamsSchema({ scheduleId: "schedules" }),
  body: updateScheduleSchema,
}, async ({ params, body, member, organization, res }) => {
  const schedule = await db.transaction(async (tx) => {
    const schedule = await lockSchedule(tx, { member, organization }, params.scheduleId)

    await assertTemplateAccessLevel(tx, { member, organization }, schedule.templateId, "edit")
    await lockTemplate(tx, { member, organization }, schedule.templateId)

    if (schedule.status === "archived") throw new HttpError("conflict", "Cannot update archived schedule")

    // If either the recurrence or the timezone change we need to compute a new rrule
    const rrule = body.recurrence || body.timezone
      ? recurrenceToRRule(
          body.recurrence ?? rruleToRecurrence(new RRuleTemporal({ rruleString: schedule.rrule })),
          body.timezone ?? schedule.timezone,
        )
      : undefined

    const next = rrule && schedule.status === "active" ? rrule.next() : undefined

    const nextRunAt = next === undefined ? undefined : next && new Date(next.epochMilliseconds)

    const [updatedSchedule] = await tx.update(schedules)
      .set({
        rrule: rrule?.toString(),
        nextRunAt,
        timezone: body.timezone,
        runNamePattern: body.runNamePattern,
      })
      .where(eq(schedules.id, schedule.id))
      .returning()
    if (!updatedSchedule) throw new HttpError("internal", "Failed to update schedule")

    return updatedSchedule
  })

  res.json(toScheduleDto(schedule))
}))

schedulesRouter.post("/:scheduleId/pause", route({
  params: typeIdParamsSchema({ scheduleId: "schedules" }),
}, async ({ params, member, organization, res }) => {
  const schedule = await db.transaction(async (tx) => {
    const schedule = await lockSchedule(tx, { member, organization }, params.scheduleId)

    await assertTemplateAccessLevel(tx, { member, organization }, schedule.templateId, "edit")
    if (schedule.status === "archived") throw new HttpError("conflict", "Cannot update archived schedule")
    if (schedule.status === "paused") throw new HttpError("conflict", "Schedule already paused")

    const [updatedSchedule] = await tx.update(schedules)
      .set({
        status: "paused",
        nextRunAt: null,
      })
      .where(eq(schedules.id, schedule.id))
      .returning()

    if (!updatedSchedule) throw new HttpError("internal", "Failed to pause schedule")

    return updatedSchedule
  })

  res.json(toScheduleDto(schedule))
}))

schedulesRouter.post("/:scheduleId/resume", route({
  params: typeIdParamsSchema({ scheduleId: "schedules" }),
}, async ({ params, member, organization, res }) => {
  const schedule = await db.transaction(async (tx) => {
    const schedule = await lockSchedule(tx, { member, organization }, params.scheduleId)

    await assertTemplateAccessLevel(tx, { member, organization }, schedule.templateId, "edit")
    if (schedule.status === "archived") throw new HttpError("conflict", "Cannot update archived schedule")
    if (schedule.status === "active") throw new HttpError("conflict", "Schedule already active")

    const rrule = new RRuleTemporal({ rruleString: schedule.rrule })
    const next = rrule.next()
    const nextRunAt = next ? new Date(next.epochMilliseconds) : null

    const [updatedSchedule] = await tx.update(schedules)
      .set({
        status: "active",
        nextRunAt,
      })
      .where(eq(schedules.id, schedule.id))
      .returning()

    if (!updatedSchedule) throw new HttpError("internal", "Failed to resume schedule")

    return updatedSchedule
  })

  res.json(toScheduleDto(schedule))
}))

schedulesRouter.post("/:scheduleId/archive", route({
  params: typeIdParamsSchema({ scheduleId: "schedules" }),
}, async ({ params, member, organization, res }) => {
  const schedule = await db.transaction(async (tx) => {
    const schedule = await lockSchedule(tx, { member, organization }, params.scheduleId)

    await assertTemplateAccessLevel(tx, { member, organization }, schedule.templateId, "edit")
    if (schedule.status === "archived") throw new HttpError("conflict", "Cannot archive already archived schedule")

    const [updatedSchedule] = await tx.update(schedules)
      .set({
        status: "archived",
        nextRunAt: null,
      })
      .where(eq(schedules.id, schedule.id))
      .returning()

    if (!updatedSchedule) throw new HttpError("internal", "Failed to archive schedule")

    return updatedSchedule
  })

  res.json(toScheduleDto(schedule))
}))

schedulesRouter.post("/:scheduleId/restore", route({
  params: typeIdParamsSchema({ scheduleId: "schedules" }),
}, async ({ params, member, organization, res }) => {
  const schedule = await db.transaction(async (tx) => {
    const schedule = await lockSchedule(tx, { member, organization }, params.scheduleId)

    await assertTemplateAccessLevel(tx, { member, organization }, schedule.templateId, "edit")
    await lockTemplate(tx, { member, organization }, schedule.templateId)

    if (schedule.status !== "archived") throw new HttpError("conflict", "Cannot unarchive non-archived schedule")

    const [updatedSchedule] = await tx.update(schedules)
      .set({
        status: "paused",
        nextRunAt: null,
      })
      .where(eq(schedules.id, schedule.id))
      .returning()

    if (!updatedSchedule) throw new HttpError("internal", "Failed to restore schedule")

    return updatedSchedule
  })

  res.json(toScheduleDto(schedule))
}))
