import z from "zod"

export const assigneeTypes = ["member", "team", "role"] as const
export const assigneeTypeSchema = z.enum(assigneeTypes)
export type AssigneeType = z.infer<typeof assigneeTypeSchema>
