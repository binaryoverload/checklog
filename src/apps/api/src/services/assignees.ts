import { and, eq } from "drizzle-orm"

import { members, teams } from "@/db/auth-schema.ts"
import { HttpError } from "@/http/errors.ts"
import type { Database } from "@/util/types.ts"
import { orgRoles } from "@checklog/shared/auth"
import type { Assignee } from "@checklog/shared/domain"

export async function assertAssigneeValid(tx: Database, assignee: Assignee | null | undefined, organizationId: string) {
  if (!assignee) return

  if (assignee.type === "member") {
    const [member] = await tx.select({ id: members.id }).from(members).where(and(eq(members.id, assignee.memberId), eq(members.organizationId, organizationId)))
    if (!member) throw new HttpError("validation_failed", "Invalid assignee: member not found", [{ location: "body", path: ["assignee", "memberId"], message: "Member not found" }])
  } else if (assignee.type === "team") {
    const [team] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, assignee.teamId), eq(teams.organizationId, organizationId)))
    if (!team) throw new HttpError("validation_failed", "Invalid assignee: team not found", [{ location: "body", path: ["assignee", "teamId"], message: "Team not found" }])
  } else if (assignee.type === "role") {
    if (!Object.hasOwn(orgRoles, assignee.role))
      throw new HttpError("validation_failed", "Invalid assignee: role not found", [{ location: "body", path: ["assignee", "role"], message: "Role not found" }])
  }
}
