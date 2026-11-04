import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements as defaultAdminStatements } from "better-auth/plugins/admin/access"
import { defaultStatements as defaultOrgStatements } from "better-auth/plugins/organization/access"

export const platformAccessControl = createAccessControl(defaultAdminStatements)

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

const appStatements = {
  template: [
    "create", // Can create new templates
    "manage", // Can view and edit all templates
  ],
  audit: [
    "read", // Can read audit logs
  ],
  // These are separate permissions because they involve a whole user account
  // rather than just membership in the organization
  managedAccount: [
    "delete", // Can delete managed accounts
    "restore", // Can restore managed accounts
  ],
} as const

export const orgAccessControl = createAccessControl({
  ...defaultOrgStatements,
  ...appStatements,
})

export type OrgStatements = typeof orgAccessControl.statements
export type OrgStatementsCheckInput = {
  [K in keyof OrgStatements]?: OrgStatements[K][number][]
}

const orgOwnerRole = orgAccessControl.newRole({
  ...defaultOrgStatements, // All better-auth permissions
  ...appStatements, // All app permissions
})

const orgAdminRole = orgAccessControl.newRole({
  ...defaultOrgStatements, // All better-auth permissions other than...
  organization: ["update"], // Org admins cannot delete the organization
  ...appStatements, // All app permissions
  managedAccount: [], // Only org owners can delete or restore managed accounts
})

const orgEditorRole = orgAccessControl.newRole({
  ac: ["read"], // Grants access to read dynamic roles
  template: ["create"],
})

const orgViewerRole = orgAccessControl.newRole({
  ac: ["read"], // Grants access to read dynamic roles
})

export const orgRoles = {
  owner: orgOwnerRole,
  admin: orgAdminRole,
  editor: orgEditorRole,
  viewer: orgViewerRole,
}
