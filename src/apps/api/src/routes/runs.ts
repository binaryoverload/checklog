import { and, count, eq, desc } from "drizzle-orm"
import { Router } from "express"

import { assertTemplateAccessLevel, runScopeWhere, visibleRunsWhere } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { runs, templates, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toRunDto, toRunWithDetailsDto } from "@/mappers/runs.ts"
import { loadRunRows, lockRun, runStartIssues, startRun } from "@/services/runs.ts"
import { toPageResult } from "@/util/pagination.ts"
import { createRunBodySchema, listRunsQuerySchema } from "@checklog/shared/api"
import { templateAccessIncludes } from "@checklog/shared/domain"
import { typeIdParamsSchema } from "@checklog/shared/utils"

export const runsRouter = Router()

runsRouter.get("/", route({ query: listRunsQuerySchema }, async ({ query, member, organization, res }) => {
  const visible = visibleRunsWhere({ member, organization })
  const inScope = runScopeWhere({ member, organization }, query.scope)
  const hasStatus = query.status ? eq(runs.status, query.status) : undefined

  const [rows, [counted]] = await Promise.all([
    db.select({ run: runs, templateId: templateVersions.templateId }).from(runs)
      .innerJoin(templateVersions, eq(templateVersions.id, runs.templateVersionId))
      .where(and(visible, inScope, hasStatus))
      .orderBy(desc(runs.id))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
    db.select({ total: count() }).from(runs).where(and(visible, inScope, hasStatus)),
  ])

  res.json(toPageResult(
    rows,
    {
      page: query.page,
      limit: query.limit,
      total: counted!.total,
      map: row => toRunDto(row.run, row.templateId),
    },
  ))
}))

runsRouter.get("/:runId", route({ params: typeIdParamsSchema({ runId: "runs" }) }, async ({ params, member, organization, res }) => {
  const [row] = await db.select({ run: runs, templateId: templateVersions.templateId }).from(runs)
    .innerJoin(templateVersions, eq(templateVersions.id, runs.templateVersionId))
    .where(and(
      eq(runs.id, params.runId),
      visibleRunsWhere({ member, organization }),
    ))
  if (!row) throw new HttpError("not_found", "Run not found")

  const runData = await loadRunRows(db, row.run, row.templateId)

  res.json(toRunWithDetailsDto(runData))
}))

runsRouter.post("/", route({ body: createRunBodySchema }, async ({ body, member, organization, timezone, res }) => {
  const runData = await db.transaction(async (tx) => {
    const [template] = await tx.select().from(templates).where(and(
      eq(templates.id, body.templateId),
      eq(templates.organizationId, organization.id),
    )).for("share")
    if (!template) throw new HttpError("not_found", "Template not found")

    await assertTemplateAccessLevel(tx, { member, organization }, template.id, "run")

    const startIssues = await runStartIssues(tx, template)
    if (startIssues.length) throw new HttpError("precondition_failed", "Run cannot be started", startIssues)

    const run = await startRun(tx, { template, name: body.name, createdBy: member.userId, timezone, scheduleId: null })

    return await loadRunRows(tx, run, template.id)
  })

  res.json(toRunWithDetailsDto(runData))
}))

runsRouter.post("/:runId/cancel", route({ params: typeIdParamsSchema({ runId: "runs" }) }, async ({ params, member, organization, res }) => {
  const runData = await db.transaction(async (tx) => {
    const { run, templateId, templateAccessLevel } = await lockRun(tx, params.runId, { member, organization })
    if (!templateAccessLevel || !templateAccessIncludes(templateAccessLevel, "run")) {
      throw new HttpError("forbidden", "You need run access to the template to cancel this run")
    }

    if (run.status !== "in_progress") throw new HttpError("conflict", "Run not in progress")

    const [updatedRun] = await tx.update(runs).set({ status: "cancelled" }).where(eq(runs.id, run.id)).returning()
    if (!updatedRun) throw new HttpError("internal", "Failed to update run")

    const runData = await loadRunRows(tx, updatedRun, templateId)

    return runData
  })

  res.json(toRunWithDetailsDto(runData))
}))
