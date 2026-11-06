import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/admin/access"

export const platformAccessControl = createAccessControl(defaultStatements)

export type PlatformStatements = typeof platformAccessControl.statements
export type PlatformStatementsCheckInput = {
  [K in keyof PlatformStatements]?: PlatformStatements[K][number][]
}

const platformAdminRole = platformAccessControl.newRole({
  user: ["list", "get", "ban", "impersonate"],
  session: ["list", "revoke"],
})

const userRole = platformAccessControl.newRole({})

export const platformAdminRoleName = "platform-admin"

export const platformRoles = {
  [platformAdminRoleName]: platformAdminRole,
  user: userRole,
}

export type PlatformRole = keyof typeof platformRoles
