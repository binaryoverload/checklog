import { and, eq } from "drizzle-orm"

import { logger } from "@/core/logger.ts"
import { teamMembers, teams } from "@/db/auth-schema.ts"
import { db } from "@/db/index.ts"
import type { SeededOrganization } from "@/seed/accounts.ts"
import type { OrgRole } from "@checklog/shared/auth"
import { typeIdForModel } from "@checklog/shared/utils"

// Groups in every seeded organization, each holding the seeded members with these roles
export const seedGroupDefinitions = {
  Maintenance: ["editor", "viewer"],
  Kitchen: ["viewer"],
} satisfies Record<string, OrgRole[]>

export type SeedGroupName = keyof typeof seedGroupDefinitions

// Inserted directly, since Better Auth's team endpoints need a signed-in session
export async function seedGroups(organization: SeededOrganization): Promise<Record<SeedGroupName, string>> {
  const groupIds = {} as Record<SeedGroupName, string>

  for (const [name, roles] of Object.entries(seedGroupDefinitions) as [SeedGroupName, OrgRole[]][]) {
    const existing = await db.query.teams.findFirst({ where: and(eq(teams.organizationId, organization.id), eq(teams.name, name)) })
    if (existing) {
      groupIds[name] = existing.id
      continue
    }

    const teamId = typeIdForModel("team").toString()
    await db.transaction(async (tx) => {
      await tx.insert(teams).values({ id: teamId, name, organizationId: organization.id, memberCount: roles.length, createdAt: new Date() })
      await tx.insert(teamMembers).values(roles.map(role => ({
        id: typeIdForModel("teamMember").toString(),
        teamId,
        userId: organization.members[role].userId,
        createdAt: new Date(),
      })))
    })
    logger.info(`Seeded group ${name} in ${organization.name}`)
    groupIds[name] = teamId
  }

  return groupIds
}
