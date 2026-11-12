import z from "zod"

export const runStatuses = ["in_progress", "completed", "cancelled"] as const
export const runStatusSchema = z.enum(runStatuses)
export type RunStatus = z.infer<typeof runStatusSchema>

export const runStepStatuses = ["pending", "completed", "skipped"] as const
export const runStepStatusSchema = z.enum(runStepStatuses)
export type RunStepStatus = z.infer<typeof runStepStatusSchema>

export const runListScopes = ["mine", "groups", "all"] as const
export const runListScopeSchema = z.enum(runListScopes)
export type RunListScope = z.infer<typeof runListScopeSchema>

export function blockedStepIds(steps: { id: string, isHalt: boolean, status: RunStepStatus }[]): Set<string> {
  const blocked = new Set<string>()
  let halt = false
  for (const s of steps) {
    if (halt) blocked.add(s.id)
    if (s.isHalt && s.status === "pending") halt = true
  }
  return blocked
}
