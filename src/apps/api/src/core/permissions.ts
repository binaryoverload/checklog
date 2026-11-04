import { HttpError } from "@/http/errors"
import type { Member, User } from "@/util/types"
import { orgRoles, platformRoles } from "@checklog/shared"
import type { OrgStatementsCheckInput, PlatformStatementsCheckInput } from "@checklog/shared"

export function can(member: Member, permissions: OrgStatementsCheckInput): boolean {
  const roles = member.role.split(",").map(role => role.trim())

  return roles.some((roleName) => {
    if (!Object.hasOwn(orgRoles, roleName)) return false

    const role = orgRoles[roleName as keyof typeof orgRoles]

    return role.authorize(permissions).success
  })
}

export function assertCan(member: Member, permissions: OrgStatementsCheckInput): void {
  if (!can(member, permissions)) {
    throw new HttpError("forbidden", "You do not have permission to perform this action")
  }
}

export function platformCan(user: User, permissions: PlatformStatementsCheckInput): boolean {
  const roles = (user.role ?? "").split(",").map(role => role.trim())

  return roles.some((roleName) => {
    if (!Object.hasOwn(platformRoles, roleName)) return false

    const role = platformRoles[roleName as keyof typeof platformRoles]

    return role.authorize(permissions).success
  })
}

export function assertPlatformCan(user: User, permissions: PlatformStatementsCheckInput): void {
  if (!platformCan(user, permissions)) {
    throw new HttpError("forbidden", "You do not have permission to perform this action")
  }
}
