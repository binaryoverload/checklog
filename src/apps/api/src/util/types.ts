import type { auth } from "@/core/auth"
import type { organizations, members, teams, users, invitations } from "@/db/auth-schema"

export type Session = typeof auth.$Infer.Session

export type Organization = typeof organizations.$inferSelect
export type Member = typeof members.$inferSelect
export type User = typeof users.$inferSelect
export type Team = typeof teams.$inferSelect
export type Invitation = typeof invitations.$inferSelect
