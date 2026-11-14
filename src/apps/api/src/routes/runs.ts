import { and, count, eq } from "drizzle-orm"
import { Router } from "express"

import { runScopeWhere, visibleRunsWhere } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { runs, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toRunDto, toRunWithDetailsDto } from "@/mappers/runs.ts"
import { loadRunRows } from "@/services/runs.ts"
import { cursorCondition, orderFor, toPage } from "@/util/pagination.ts"
import type { SortDefinition } from "@/util/pagination.ts"
import type { Run } from "@/util/types.ts"
import { listRunsQuerySchema } from "@checklog/shared/api"
import { typeIdParamSchema } from "@checklog/shared/utils"

export const runsRouter = Router()

const runSort: SortDefinition<{ run: Run, templateId: string }> = {
  key: "newest",
  direction: "desc",
  idColumn: runs.id,
  idOf: row => row.run.id,
}

runsRouter.get("/", route({ query: listRunsQuerySchema }, async ({ query, member, organization, res }) => {
  const visible = visibleRunsWhere({ member, organization })
  const inScope = runScopeWhere({ member, organization }, query.scope)
  const hasStatus = query.status ? eq(runs.status, query.status) : undefined

  const [rows, [counted]] = await Promise.all([
    db.select({ run: runs, templateId: templateVersions.templateId }).from(runs)
      .innerJoin(templateVersions, eq(templateVersions.id, runs.templateVersionId))
      .where(and(visible, inScope, hasStatus, cursorCondition(runSort, query.cursor)))
      .orderBy(...orderFor(runSort))
      .limit(query.limit + 1),
    db.select({ total: count() }).from(runs).where(and(visible, inScope, hasStatus)),
  ])

  res.json(toPage(
    rows,
    {
      limit: query.limit,
      total: counted!.total,
      sort: runSort,
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

runsRouter.post("/:id/cancel", route({ params: typeIdParamSchema("runs") }, ({ res }) => {
  throw new Error("Not implemented")
}))
