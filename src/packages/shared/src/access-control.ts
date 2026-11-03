import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/admin/access"

export const betterAuthAccessControl = createAccessControl(defaultStatements)

const platformAdminRole = betterAuthAccessControl.newRole({
  user: ["list", "get", "ban", "impersonate"],
  session: ["list", "revoke"],
})

const userRole = betterAuthAccessControl.newRole({})

export const platformAdminRoleName = "platform-admin"

export const betterAuthRoles = {
  [platformAdminRoleName]: platformAdminRole,
  user: userRole,
}
