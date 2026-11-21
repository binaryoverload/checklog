import z from "zod"

import { sortOrderSchema } from "./common.ts"
import type { CreatedFields, UpdatedFields } from "./common.ts"
import { pageQuerySchema } from "./pagination.ts"
import { approvalDecisionStatusSchema } from "../domain/approvals.ts"
import type { ApprovalDecisionStatus, ApprovalStatus } from "../domain/approvals.ts"
import { requiredString } from "../utils/zod.ts"

export const approvalDecisionBodySchema = z.strictObject({
  decision: approvalDecisionStatusSchema,
  comment: requiredString().optional(),
}).refine(b => b.decision === "approved" || (b.decision === "rejected" && b.comment), { path: ["comment"], error: "Comment required for rejection" })
export type ApprovalDecisionBody = z.infer<typeof approvalDecisionBodySchema>

export const approvalsListQuerySchema = pageQuerySchema().and(z.object({
  status: z.enum(["pending", "all"]).default("pending"),
  order: sortOrderSchema.default("asc"),
}))

export type ApprovalRequestDto = {
  id: string
  runStepId: string
  status: ApprovalStatus
  decisions: ApprovalDecisionDto[]
} & CreatedFields & UpdatedFields

export type ApprovalRequestDetailDto = ApprovalRequestDto & {
  run: { id: string, name: string }
  step: { id: string, title: string }
}

export type ApprovalDecisionDto = {
  id: string
  decision: ApprovalDecisionStatus
  comment: string | null
} & CreatedFields
