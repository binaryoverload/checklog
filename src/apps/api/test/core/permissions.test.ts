import { describe, expect, test } from "vitest"

import { assertCan, assertPlatformCan, can, platformCan } from "@/core/permissions.ts"
import type { Member, User } from "@/util/types.ts"
import { platformAdminRoleName } from "@checklog/shared"

function member(role: string): Member {
  return { id: "mem_test", organizationId: "org_test", userId: "user_test", role, createdAt: new Date() }
}

function user(role: string | null): User {
  return { id: "user_test", role } as User
}

describe("can", () => {
  test.each([
    ["owner", true, true, true, true],
    ["admin", true, true, true, false],
    ["editor", true, false, false, false],
    ["viewer", false, false, false, false],
  ])("%s: create templates %s, manage templates %s, read audit %s, delete managed accounts %s", (role, createTemplates, manageTemplates, readAudit, deleteManagedAccounts) => {
    expect(can(member(role), { template: ["create"] })).toBe(createTemplates)
    expect(can(member(role), { template: ["manage"] })).toBe(manageTemplates)
    expect(can(member(role), { audit: ["read"] })).toBe(readAudit)
    expect(can(member(role), { managedAccount: ["delete"] })).toBe(deleteManagedAccounts)
  })

  test("only owners can delete the organization", () => {
    expect(can(member("owner"), { organization: ["delete"] })).toBe(true)
    expect(can(member("admin"), { organization: ["delete"] })).toBe(false)
  })

  test("a member with several roles gets the permissions of each", () => {
    expect(can(member("viewer,editor"), { template: ["create"] })).toBe(true)
    expect(can(member("viewer, admin"), { template: ["manage"] })).toBe(true)
  })

  test("every permission asked for must be granted", () => {
    expect(can(member("editor"), { template: ["create", "manage"] })).toBe(false)
    expect(can(member("admin"), { template: ["create", "manage"], audit: ["read"] })).toBe(true)
  })

  test("unknown and removed roles grant nothing", () => {
    expect(can(member("member"), { template: ["create"] })).toBe(false)
    expect(can(member(""), { template: ["create"] })).toBe(false)
  })

  test("names inherited from Object.prototype aren't roles", () => {
    expect(can(member("toString"), { template: ["create"] })).toBe(false)
    expect(can(member("constructor"), { template: ["create"] })).toBe(false)
  })

  test("asking for nothing is refused", () => {
    expect(can(member("owner"), {})).toBe(false)
  })

  test("assertCan throws forbidden when refused", () => {
    expect(() => assertCan(member("viewer"), { template: ["create"] })).toThrow(expect.objectContaining({ code: "forbidden" }))
    expect(() => assertCan(member("editor"), { template: ["create"] })).not.toThrow()
  })
})

describe("platformCan", () => {
  test("platform admins can ban and impersonate", () => {
    expect(platformCan(user(platformAdminRoleName), { user: ["ban", "impersonate"] })).toBe(true)
  })

  test("platform admins can't change roles or delete users", () => {
    expect(platformCan(user(platformAdminRoleName), { user: ["set-role"] })).toBe(false)
    expect(platformCan(user(platformAdminRoleName), { user: ["delete"] })).toBe(false)
  })

  test("ordinary users and users without a role have no platform permissions", () => {
    expect(platformCan(user("user"), { user: ["list"] })).toBe(false)
    expect(platformCan(user(null), { user: ["list"] })).toBe(false)
  })

  test("organization roles aren't platform roles", () => {
    expect(platformCan(user("owner"), { user: ["list"] })).toBe(false)
  })

  test("assertPlatformCan throws forbidden when refused", () => {
    expect(() => assertPlatformCan(user("user"), { session: ["list"] })).toThrow(expect.objectContaining({ code: "forbidden" }))
  })
})
