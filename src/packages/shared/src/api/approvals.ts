import z from "zod"

import type { CreatedFields, UpdatedFields } from "./common.ts"
import { approvalDecisionStatusSchema } from "../domain/approvals.ts"
import type { ApprovalDecisionStatus, ApprovalStatus } from "../domain/approvals.ts"
import { requiredString } from "../utils/zod.ts"

export const approvalDecisionBodySchema = z.strictObject({
  decision: approvalDecisionStatusSchema,
  comment: requiredString().optional(),
}).refine(b => b.decision === "approved" || (b.decision === "rejected" && b.comment), { path: ["comment"], error: "Comment required for rejection" })
export type ApprovalDecisionBody = z.infer<typeof approvalDecisionBodySchema>

export type ApprovalRequestDto = {
  id: string
  runStepId: string
  status: ApprovalStatus
  decisions: ApprovalDecisionDto[]
} & CreatedFields & UpdatedFields

export type ApprovalDecisionDto = {
  id: string
  decision: ApprovalDecisionStatus
  comment: string | null
} & CreatedFields
