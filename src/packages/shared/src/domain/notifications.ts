import z from "zod"

export const notificationTypes = ["assigned_step", "overdue_step", "approval_needed", "schedule_skipped"] as const
export const notificationTypeSchema = z.enum(notificationTypes)
export type NotificationType = z.infer<typeof notificationTypeSchema>

export const notificationSubjectTypes = ["run_step", "schedule"] as const
export const notificationSubjectTypeSchema = z.enum(notificationSubjectTypes)
export type NotificationSubjectType = z.infer<typeof notificationSubjectTypeSchema>

export const notificationChannels = ["email"] as const
export const notificationChannelSchema = z.enum(notificationChannels)
export type NotificationChannel = z.infer<typeof notificationChannelSchema>

export const notificationDeliveryStatuses = ["pending", "sent", "failed"] as const
export const notificationDeliveryStatusSchema = z.enum(notificationDeliveryStatuses)
export type NotificationDeliveryStatus = z.infer<typeof notificationDeliveryStatusSchema>

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
