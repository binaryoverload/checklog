import { and, eq } from "drizzle-orm"
import { Router } from "express"

import { db } from "@/db/index.ts"
import { approvalDecisions, approvalRequests, runSteps } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { route } from "@/http/route.ts"
import { toRunWithDetailsDto } from "@/mappers/runs.ts"
import { completeRunIfResolved, createReachedApprovalRequests, loadRunRows, requireRunStep } from "@/services/runs.ts"
import { approvalDecisionBodySchema } from "@checklog/shared/api"
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
