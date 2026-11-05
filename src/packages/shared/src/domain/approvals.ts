import z from "zod"

export const approvalStatuses = ["pending", "approved", "rejected"] as const
export const approvalStatusSchema = z.enum(approvalStatuses)
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>

export const approvalDecisionStatuses = ["approved", "rejected"] as const
export const approvalDecisionStatusSchema = z.enum(approvalDecisionStatuses)
export type ApprovalDecisionStatus = z.infer<typeof approvalDecisionStatusSchema>
