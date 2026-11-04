import type { auth } from "@/core/auth"
import type { db } from "@/db"
import type { organizations, members, teams, users, invitations } from "@/db/auth-schema"

export type Session = typeof auth.$Infer.Session

export type Organization = typeof organizations.$inferSelect
export type Member = typeof members.$inferSelect
export type User = typeof users.$inferSelect
export type Team = typeof teams.$inferSelect
export type Invitation = typeof invitations.$inferSelect

export type Database = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
