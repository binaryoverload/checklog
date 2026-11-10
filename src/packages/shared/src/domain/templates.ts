import z from "zod"

import type { Assignee, AssigneeType } from "./assignees.ts"
import type { FieldOptions } from "./fields.ts"
import type { PreconditionIssue } from "./preconditions.ts"

export const templateStatuses = ["active", "archived"] as const
export const templateStatusSchema = z.enum(templateStatuses)
export type TemplateStatus = z.infer<typeof templateStatusSchema>

export const templateVersionStatuses = ["draft", "published", "archived"] as const
export const templateVersionStatusSchema = z.enum(templateVersionStatuses)
export type TemplateVersionStatus = z.infer<typeof templateVersionStatusSchema>

export const templateStepKinds = ["task", "approval"] as const
export const templateStepKindSchema = z.enum(templateStepKinds)
export type TemplateStepKind = z.infer<typeof templateStepKindSchema>

// Order is important, each level includes the permissions of the previous levels
export const templateAccessLevels = ["view", "run", "edit"] as const
export const templateAccessLevelSchema = z.enum(templateAccessLevels)
export type TemplateAccessLevel = z.infer<typeof templateAccessLevelSchema>

export function templateAccessIncludes(has: TemplateAccessLevel, needs: TemplateAccessLevel): boolean {
  return templateAccessLevels.indexOf(has) >= templateAccessLevels.indexOf(needs)
}

export function highestTemplateAccessLevel(levels: TemplateAccessLevel[]): TemplateAccessLevel | null {
  if (levels.length === 0) return null
  return levels.reduce((highest, level) => (templateAccessIncludes(highest, level) ? highest : level))
}

export function templateStepRuleIssues(step: { kind: TemplateStepKind, isHalt: boolean, skippable: boolean, assignee?: Assignee | null }) {
  const issues: { path: string[], message: string }[] = []
  if (step.kind === "approval" && step.assignee == null) issues.push({ path: ["assignee"], message: "Approval steps must have an assignee" })
  if (step.kind === "approval" && step.skippable) issues.push({ path: ["skippable"], message: "Approval steps cannot be skippable" })
  if (step.isHalt && step.skippable) issues.push({ path: ["skippable"], message: "Halt steps cannot be skippable" })
  return issues
}

export function templateVersionPublishIssues(
  versionId: string,
  steps: { id: string, assigneeType: AssigneeType | null, assignee: Assignee | null }[],
  fields: { id: string, templateStepId: string, options: FieldOptions }[],
): PreconditionIssue[] {
  const issues: PreconditionIssue[] = []

  if (steps.length === 0) {
    issues.push({ location: "resource", resourceType: "templateVersion", problem: "no_steps", versionId, message: "Template must have at least one step" })
  }

  for (const step of steps) {
    if (step.assigneeType != null && step.assignee == null) {
      issues.push({ location: "resource", resourceType: "templateStep", problem: "missing_assignee", stepId: step.id, fieldId: null, message: "Step has an invalid assignee" })
    }
  }

  for (const field of fields) {
    if (field.options.type === "dropdown" && (field.options.choices.length === 0)) {
      issues.push({ location: "resource", resourceType: "templateStep", problem: "dropdown_without_choices", stepId: field.templateStepId, fieldId: field.id, message: "Dropdown field has no choices" })
    }
  }

  return issues
}
