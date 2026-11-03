import { platformAdminRoleName } from "@checklog/shared"

// Better Auth stores several admin roles as one comma-separated string
export function isPlatformAdmin(user: { role?: string | null } | null | undefined): boolean {
  return user?.role?.split(",").some(role => role.trim() === platformAdminRoleName) ?? false
}
