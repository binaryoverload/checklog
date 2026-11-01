import z from "zod"

export const fieldTypes = ["text", "number", "date", "dropdown", "checkbox"] as const
export const fieldTypeSchema = z.enum(fieldTypes)
export type FieldType = z.infer<typeof fieldTypeSchema>

export const templateStatuses = ["active", "archived"] as const
export const templateStatusSchema = z.enum(templateStatuses)
export type TemplateStatus = z.infer<typeof templateStatusSchema>

export const templateVersionStatuses = ["draft", "published", "archived"] as const
export const templateVersionStatusSchema = z.enum(templateVersionStatuses)
export type TemplateVersionStatus = z.infer<typeof templateVersionStatusSchema>

export const templateStepKinds = ["task", "approval"] as const
export const templateStepKindSchema = z.enum(templateStepKinds)
export type TemplateStepKind = z.infer<typeof templateStepKindSchema>

export const templateAccessLevels = ["view", "run", "edit"] as const
export const templateAccessLevelSchema = z.enum(templateAccessLevels)
export type TemplateAccessLevel = z.infer<typeof templateAccessLevelSchema>

export const runStatuses = ["in_progress", "completed", "cancelled"] as const
export const runStatusSchema = z.enum(runStatuses)
export type RunStatus = z.infer<typeof runStatusSchema>

export const runStepStatuses = ["pending", "completed", "skipped"] as const
export const runStepStatusSchema = z.enum(runStepStatuses)
export type RunStepStatus = z.infer<typeof runStepStatusSchema>

export const scheduleStatuses = ["active", "paused", "archived"] as const
export const scheduleStatusSchema = z.enum(scheduleStatuses)
export type ScheduleStatus = z.infer<typeof scheduleStatusSchema>

export const assigneeTypes = ["member", "team", "role"] as const
export const assigneeTypeSchema = z.enum(assigneeTypes)
export type AssigneeType = z.infer<typeof assigneeTypeSchema>

export const dateTypes = ["date", "datetime", "time"] as const
export const dateTypeSchema = z.enum(dateTypes)
export type DateType = z.infer<typeof dateTypeSchema>
