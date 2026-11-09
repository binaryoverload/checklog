import type { auth } from "@/core/auth.ts"
import type { organizations, members, teams, users, invitations } from "@/db/auth-schema.ts"
import type { db } from "@/db/index.ts"
import type { approvalDecisions, approvalRequests, notificationDeliveries, notifications, runFieldValues, runs, runSteps, schedules, stepNotes, templateAccess, templateFields, templates, templateSteps, templateVersions } from "@/db/schema.ts"

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type Database = typeof db | Transaction

export type Session = typeof auth.$Infer.Session

export type Organization = typeof organizations.$inferSelect
export type Member = typeof members.$inferSelect
export type User = typeof users.$inferSelect
export type Team = typeof teams.$inferSelect
export type Invitation = typeof invitations.$inferSelect

export interface UserContext {
  organization: Organization
  member: Member
}

export type Template = typeof templates.$inferSelect
export type TemplateVersion = typeof templateVersions.$inferSelect
export type TemplateStep = typeof templateSteps.$inferSelect
export type TemplateField = typeof templateFields.$inferSelect
export type TemplateAccess = typeof templateAccess.$inferSelect
export type Schedule = typeof schedules.$inferSelect
export type Run = typeof runs.$inferSelect
export type RunStep = typeof runSteps.$inferSelect
export type RunFieldValue = typeof runFieldValues.$inferSelect
export type StepNote = typeof stepNotes.$inferSelect
export type ApprovalRequest = typeof approvalRequests.$inferSelect
export type ApprovalDecision = typeof approvalDecisions.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type NotificationDeliveries = typeof notificationDeliveries.$inferSelect
