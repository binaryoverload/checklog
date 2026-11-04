import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements as defaultAdminStatements } from "better-auth/plugins/admin/access"
import { defaultStatements as defaultOrgStatements } from "better-auth/plugins/organization/access"

export const platformAccessControl = createAccessControl(defaultAdminStatements)

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
} as const

export const orgAccessControl = createAccessControl({
  ...defaultOrgStatements,
  ...appStatements,
})

const orgOwnerRole = orgAccessControl.newRole({
  ...defaultOrgStatements, // All better-auth permissions
  ...appStatements, // All app permissions
})

const orgAdminRole = orgAccessControl.newRole({
  ...defaultOrgStatements, // All better-auth permissions other than...
  organization: ["update"], // Org admins cannot delete the organization
  ...appStatements, // All app permissions
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
