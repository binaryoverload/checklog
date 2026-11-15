import { describe, expect, test } from "vitest"

import { memberCan } from "@checklog/shared/auth"

function member(role: string) {
  return { role }
}

describe("memberCan", () => {
  test.each([
    ["owner", true, true, true, true],
    ["admin", true, true, true, false],
    ["editor", true, false, false, false],
    ["viewer", false, false, false, false],
  ])("%s: create templates %s, manage templates %s, read audit %s, delete managed accounts %s", (role, createTemplates, manageTemplates, readAudit, deleteManagedAccounts) => {
    expect(memberCan(member(role), { template: ["create"] })).toBe(createTemplates)
    expect(memberCan(member(role), { template: ["manage"] })).toBe(manageTemplates)
    expect(memberCan(member(role), { audit: ["read"] })).toBe(readAudit)
    expect(memberCan(member(role), { managedAccount: ["delete"] })).toBe(deleteManagedAccounts)
  })

  test("only owners can delete the organization", () => {
    expect(memberCan(member("owner"), { organization: ["delete"] })).toBe(true)
    expect(memberCan(member("admin"), { organization: ["delete"] })).toBe(false)
  })

  test("a member with several roles gets the permissions of each", () => {
    expect(memberCan(member("viewer,editor"), { template: ["create"] })).toBe(true)
    expect(memberCan(member("viewer, admin"), { template: ["manage"] })).toBe(true)
  })

  test("every permission asked for must be granted", () => {
    expect(memberCan(member("editor"), { template: ["create", "manage"] })).toBe(false)
    expect(memberCan(member("admin"), { template: ["create", "manage"], audit: ["read"] })).toBe(true)
  })

  test("unknown and removed roles grant nothing", () => {
    expect(memberCan(member("member"), { template: ["create"] })).toBe(false)
    expect(memberCan(member(""), { template: ["create"] })).toBe(false)
  })

  test("names inherited from Object.prototype aren't roles", () => {
    expect(memberCan(member("toString"), { template: ["create"] })).toBe(false)
    expect(memberCan(member("constructor"), { template: ["create"] })).toBe(false)
  })

  test("asking for nothing is refused", () => {
    expect(memberCan(member("owner"), {})).toBe(false)
  })
})
