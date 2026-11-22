import { platformAdminRoleName } from "./platform.ts"

export function memberRoles(member: { role: string }): string[] {
  return member.role.split(",").map(r => r.trim())
}

export function isPlatformAdmin(user: { role?: string | null }) {
  if (!user.role) return false
  return memberRoles(user as { role: string }).includes(platformAdminRoleName)
}
