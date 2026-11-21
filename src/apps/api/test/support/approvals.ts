import { asc, eq } from "drizzle-orm"

import { db } from "@/db/index.ts"
import { approvalDecisions, approvalRequests } from "@/db/schema.ts"
import type { ApprovalRequest, RunStep } from "@/util/types.ts"

export async function insertApprovalRequest(step: RunStep, values: Partial<typeof approvalRequests.$inferInsert> = {}): Promise<ApprovalRequest> {
  const [row] = await db.insert(approvalRequests).values({
    organizationId: step.organizationId,
    runStepId: step.id,
    createdBy: "user_someone_else",
    ...values,
  }).returning()
  return row!
}

export async function insertApprovalDecision(request: ApprovalRequest, decision: "approved" | "rejected", comment: string | null = null) {
  const [row] = await db.insert(approvalDecisions).values({
    organizationId: request.organizationId,
    approvalRequestId: request.id,
    decision,
    comment,
    createdBy: "user_someone_else",
  }).returning()
  return row!
}

export async function approvalRequestsOf(step: RunStep) {
  return db.select().from(approvalRequests).where(eq(approvalRequests.runStepId, step.id))
}

export async function storedApprovalRequest(requestId: string) {
  const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId))
  return row
}

export async function decisionsOf(request: ApprovalRequest) {
  return db.select().from(approvalDecisions)
    .where(eq(approvalDecisions.approvalRequestId, request.id))
    .orderBy(asc(approvalDecisions.createdAt), asc(approvalDecisions.id))
}
