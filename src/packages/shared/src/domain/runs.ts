import z from "zod"

export const runStatuses = ["in_progress", "completed", "cancelled"] as const
export const runStatusSchema = z.enum(runStatuses)
export type RunStatus = z.infer<typeof runStatusSchema>

export const runStepStatuses = ["pending", "completed", "skipped"] as const
export const runStepStatusSchema = z.enum(runStepStatuses)
export type RunStepStatus = z.infer<typeof runStepStatusSchema>
