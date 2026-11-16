import { and, count, eq, desc } from "drizzle-orm"
import { Router } from "express"

import { runScopeWhere, visibleRunsWhere } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { runs, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toRunDto, toRunWithDetailsDto } from "@/mappers/runs.ts"
import { loadRunRows, lockRun } from "@/services/runs.ts"
import { toPageResult } from "@/util/pagination.ts"
import { listRunsQuerySchema } from "@checklog/shared/api"
import { templateAccessIncludes } from "@checklog/shared/domain"
import { typeIdParamSchema } from "@checklog/shared/utils"

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

runsRouter.get("/:id", route({ params: typeIdParamSchema("runs") }, async ({ params, member, organization, res }) => {
  const [row] = await db.select({ run: runs, templateId: templateVersions.templateId }).from(runs)
    .innerJoin(templateVersions, eq(templateVersions.id, runs.templateVersionId))
    .where(and(
      eq(runs.id, params.id),
      visibleRunsWhere({ member, organization }),
    ))
  if (!row) throw new HttpError("not_found", "Run not found")

  const runData = await loadRunRows(db, row.run, row.templateId)

  res.json(toRunWithDetailsDto(runData))
}))

runsRouter.post("/", route({}, ({ res }) => {
  throw new Error("Not implemented")
}))

runsRouter.post("/:id/cancel", route({ params: typeIdParamSchema("runs") }, async ({ params, member, organization, res }) => {
  const runData = await db.transaction(async (tx) => {
    const { run, templateId, templateAccessLevel } = await lockRun(tx, params.id, { member, organization })
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
