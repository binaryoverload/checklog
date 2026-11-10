import z from "zod"

export const preconditionIssueSchema = z.discriminatedUnion("resourceType", [
  z.object({
    location: z.literal("resource"),
    resourceType: z.literal("templateStep"),
    problem: z.enum(["missing_assignee", "dropdown_without_choices"]),
    stepId: z.string(),
    fieldId: z.string().nullable(),
    message: z.string(),
  }),
  z.object({
    location: z.literal("resource"),
    resourceType: z.literal("templateVersion"),
    problem: z.enum(["no_steps", "version_archived"]),
    versionId: z.string(),
    message: z.string(),
  }),
  z.object({
    location: z.literal("resource"),
    resourceType: z.literal("template"),
    problem: z.enum(["template_archived", "no_current_version"]),
    templateId: z.string(),
    message: z.string(),
  }),
])
export type PreconditionIssue = z.infer<typeof preconditionIssueSchema>
