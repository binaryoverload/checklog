import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/organization/access"

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
  ...defaultStatements,
  ...appStatements,
})

export type OrgStatements = typeof orgAccessControl.statements
export type OrgStatementsCheckInput = {
  [K in keyof OrgStatements]?: OrgStatements[K][number][]
}

const orgOwnerRole = orgAccessControl.newRole({
  ...defaultStatements, // All better-auth permissions
  ...appStatements, // All app permissions
})

const orgAdminRole = orgAccessControl.newRole({
  ...defaultStatements, // All better-auth permissions other than...
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
