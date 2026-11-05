import z from "zod"

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
