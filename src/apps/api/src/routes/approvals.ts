import { and, count, eq, getTableColumns, inArray, or } from "drizzle-orm"
import { groupBy } from "es-toolkit"
import { Router } from "express"

import { stepAssignedToQueries } from "@/core/permissions.ts"
import { db } from "@/db/index.ts"
import { approvalDecisions, approvalRequests, runs, runSteps, templateSteps } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toApprovalRequestDetailDto } from "@/mappers/approvals.ts"
import { toRunWithDetailsDto } from "@/mappers/runs.ts"
import { completeRunIfResolved, createReachedApprovalRequests, loadRunRows, requireRunStep } from "@/services/runs.ts"
import { buildOrderBy } from "@/util/db.ts"
import { toPageResult } from "@/util/pagination.ts"
import type { ApprovalDecision } from "@/util/types.ts"
import { approvalDecisionBodySchema, approvalsListQuerySchema } from "@checklog/shared/api"
import { typeIdParamsSchema } from "@checklog/shared/utils"

export const approvalsRouter = Router()

approvalsRouter.post("/:approvalId/decisions", route({
  params: typeIdParamsSchema({ approvalId: "approvalRequests" }),
  body: approvalDecisionBodySchema,
}, async ({ params, body, member, organization, res }) => {
  const runData = await db.transaction(async (tx) => {
    const [row] = await tx.select({ approval: approvalRequests, runStep: runSteps }).from(approvalRequests)
      .innerJoin(runSteps, eq(runSteps.id, approvalRequests.runStepId))
      .where(and(
        eq(approvalRequests.id, params.approvalId),
        eq(approvalRequests.organizationId, organization.id),
      ))

    if (!row) throw new HttpError("not_found", "Approval request not found")

    const { run, step, templateId } = await requireRunStep(tx, { member, organization }, row.runStep.runId, row.runStep.id, "assignee")

    if (run.status !== "in_progress") throw new HttpError("conflict", "Run not in progress")
    if (step.status !== "pending") throw new HttpError("conflict", "Approval already decided")

    await tx.update(approvalRequests).set({ status: body.decision }).where(eq(approvalRequests.id, params.approvalId))
    await tx.insert(approvalDecisions).values({
      approvalRequestId: params.approvalId,
      decision: body.decision,
      createdBy: member.userId,
      organizationId: organization.id,
      comment: body.comment,
    })

    if (body.decision !== "approved") return await loadRunRows(tx, run, templateId)

    await tx.update(runSteps).set({
      status: "completed",
      completedBy: member.userId,
      completedAt: new Date(),
    }).where(eq(runSteps.id, step.id))

    const updatedRun = await completeRunIfResolved(tx, run)

    await createReachedApprovalRequests(tx, updatedRun, member.userId)

    return await loadRunRows(tx, updatedRun, templateId)
  })

  res.json(toRunWithDetailsDto(runData))
}))

approvalsRouter.get("/", route({
  query: approvalsListQuerySchema,
}, async ({ query, member, organization, res }) => {
  const assignedQueries = stepAssignedToQueries({ member, organization })

  const whereQuery = and(
    or(
      assignedQueries.member,
      assignedQueries.teams,
      assignedQueries.roles,
    ),
    eq(approvalRequests.organizationId, organization.id),
    query.status === "pending" ? or(eq(approvalRequests.status, "pending"), eq(approvalRequests.status, "rejected")) : undefined,
    query.status === "pending" ? eq(runs.status, "in_progress") : undefined,
  )

  const [requests, [totalRow]] = await Promise.all([
    db.select({
      ...getTableColumns(approvalRequests),
      run: { id: runs.id, name: runs.name },
      step: { id: runSteps.id, title: templateSteps.title },
    }).from(approvalRequests)
      .innerJoin(runSteps, eq(runSteps.id, approvalRequests.runStepId))
      .innerJoin(templateSteps, eq(templateSteps.id, runSteps.templateStepId))
      .innerJoin(runs, eq(runs.id, runSteps.runId))
      .where(whereQuery)
      .orderBy(...buildOrderBy(query.order, [approvalRequests.createdAt, approvalRequests.id]))
      .offset((query.page - 1) * query.limit)
      .limit(query.limit),
    db.select({ count: count() }).from(approvalRequests)
      .innerJoin(runSteps, eq(runSteps.id, approvalRequests.runStepId))
      .innerJoin(runs, eq(runs.id, runSteps.runId))
      .where(whereQuery),
  ])

  let decisions: ApprovalDecision[] = []
  if (requests.length > 0) {
    decisions = await db.select().from(approvalDecisions).where(and(
      eq(approvalDecisions.organizationId, organization.id),
      inArray(approvalDecisions.approvalRequestId, requests.map(r => r.id)),
    ))
  }

  const decisionsByRequest = groupBy(decisions, d => d.approvalRequestId)

  res.json(toPageResult(requests, {
    total: totalRow?.count ?? 0,
    page: query.page,
    limit: query.limit,
    map: request => toApprovalRequestDetailDto(request, decisionsByRequest[request.id] ?? []),
  }))
}))
