import z from "zod"

import type { PreconditionIssue } from "./preconditions.ts"
import { typeIdSchema } from "../utils/typeid.ts"

export const assigneeTypes = ["member", "team", "role"] as const
export const assigneeTypeSchema = z.enum(assigneeTypes)
export type AssigneeType = z.infer<typeof assigneeTypeSchema>

export const assigneeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("member"), memberId: typeIdSchema("member") }),
  z.strictObject({ type: z.literal("team"), teamId: typeIdSchema("team") }),
  z.strictObject({ type: z.literal("role"), role: z.string() }),
])
export type Assignee = z.infer<typeof assigneeSchema>

export function assigneeToFlat(assignee: Assignee | null) {
  if (!assignee) return {
    assigneeType: null,
    assigneeMemberId: null,
    assigneeTeamId: null,
    assigneeRole: null,
  } as const

  switch (assignee.type) {
    case "member":
      return {
        assigneeType: "member",
        assigneeMemberId: assignee.memberId,
        assigneeTeamId: null,
        assigneeRole: null,
      } as const
    case "team":
      return {
        assigneeType: "team",
        assigneeTeamId: assignee.teamId,
        assigneeMemberId: null,
        assigneeRole: null,
      } as const
    case "role":
      return {
        assigneeType: "role",
        assigneeRole: assignee.role,
        assigneeMemberId: null,
        assigneeTeamId: null,
      } as const
  }
}

export function flatToAssignee(flat: {
  assigneeType: AssigneeType | null
  assigneeMemberId: string | null
  assigneeTeamId: string | null
  assigneeRole: string | null
}): Assignee | null {
  if (!flat.assigneeType) return null
  switch (flat.assigneeType) {
    case "member":
      if (!flat.assigneeMemberId) return null
      return { type: "member", memberId: flat.assigneeMemberId }
    case "team":
      if (!flat.assigneeTeamId) return null
      return { type: "team", teamId: flat.assigneeTeamId }
    case "role":
      if (!flat.assigneeRole) return null
      return { type: "role", role: flat.assigneeRole }
  }
}

export function missingAssigneeIssues(
  steps: { id: string, assigneeType: AssigneeType | null, assignee: Assignee | null }[],
): PreconditionIssue[] {
  const issues: PreconditionIssue[] = []
  for (const step of steps) {
    if (step.assigneeType != null && step.assignee == null) {
      issues.push({
        location: "resource",
        resourceType: "templateStep",
        problem: "missing_assignee",
        stepId: step.id,
        fieldId: null,
        message: "Step has an invalid assignee",
      })
    }
  }
  return issues
}
