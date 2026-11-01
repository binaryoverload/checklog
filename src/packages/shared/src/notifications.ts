import z from "zod"

export const notificationViaSchema = z.discriminatedUnion("principal", [
  z.object({
    principal: z.literal("member"),
  }),
  z.object({
    principal: z.literal("team"),
    teamId: z.string(),
    teamName: z.string(),
  }),
  z.object({
    principal: z.literal("role"),
    roleId: z.string().nullable(),
    roleName: z.string(),
  }),
])

const runRefSchema = z.object({ id: z.string(), name: z.string() })
const runStepRefSchema = z.object({ id: z.string(), title: z.string() })

export const notificationPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assigned_step"),
    run: runRefSchema,
    runStep: runStepRefSchema,
    dueAt: z.iso.datetime().nullable(),
    via: notificationViaSchema,
  }),
  z.object({
    type: z.literal("approval_needed"),
    run: runRefSchema,
    runStep: runStepRefSchema,
    approvalRequestId: z.string(),
  }),
  z.object({
    type: z.literal("overdue_step"),
    run: runRefSchema,
    runStep: runStepRefSchema,
    dueAt: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("schedule_skipped"),
    scheduleId: z.string(),
    template: z.object({
      id: z.string(),
      name: z.string(),
    }),
    scheduledFor: z.iso.datetime(),
    reasons: z.array(z.discriminatedUnion("reason", [
      z.object({
        reason: z.literal("missing_assignee"),
        templateSteps: z.array(z.object({
          id: z.string(),
          title: z.string(),
        })).min(1),
      }),
    ])).min(1),
  }),
])

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>
