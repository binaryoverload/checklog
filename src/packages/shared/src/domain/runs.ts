import z from "zod"

import type { FieldValue } from "./fields.ts"

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

export function missingRequiredFields<TField extends { id: string, required: boolean }>(
  fields: TField[],
  values: { templateFieldId: string, value: FieldValue | null }[],
): TField[] {
  const valuesByField = new Map(values.map(v => [v.templateFieldId, v.value]))
  return fields.filter(field => field.required && isEmptyFieldValue(valuesByField.get(field.id) ?? null))
}

export function isEmptyFieldValue(value: FieldValue | null): boolean {
  if (value === null) return true
  if (value.type === "text") return value.value.trim() === ""
  if (value.type === "dropdown") return value.values.length === 0
  return false
}

export function allStepsResolved(steps: { status: RunStepStatus }[]) {
  return steps.every(s => s.status !== "pending")
}
