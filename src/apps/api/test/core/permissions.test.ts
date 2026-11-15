import { describe, expect, test } from "vitest"

import { assertCan, assertPlatformCan, canActOnStep, platformCan } from "@/core/permissions.ts"
import type { Member, User } from "@/util/types.ts"
import { platformAdminRoleName } from "@checklog/shared/auth"

function member(role: string): Member {
  return { id: "mem_test", organizationId: "org_test", userId: "user_test", role, createdAt: new Date() }
}

function user(role: string | null): User {
  return { id: "user_test", role } as User
}

describe("assertCan", () => {
  test("throws forbidden when refused", () => {
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

describe("canActOnStep", () => {
  // The member's ID and user ID differ, so a check against the wrong one fails
  const editor = member("editor")
  const teamIds = ["team_mine", "team_other_mine"]

  const unassigned = { assigneeType: null, assigneeMemberId: null, assigneeTeamId: null, assigneeRole: null }
  const assignedToMember = (memberId: string | null) => ({ ...unassigned, assigneeType: "member" as const, assigneeMemberId: memberId })
  const assignedToTeam = (teamId: string | null) => ({ ...unassigned, assigneeType: "team" as const, assigneeTeamId: teamId })
  const assignedToRole = (role: string | null) => ({ ...unassigned, assigneeType: "role" as const, assigneeRole: role })

  describe("a step assigned to a member", () => {
    test("lets that member act, matching on the membership ID", () => {
      expect(canActOnStep(assignedToMember(editor.id), editor, teamIds, null)).toBe(true)
    })

    test("doesn't match the member's user ID", () => {
      expect(canActOnStep(assignedToMember(editor.userId), editor, teamIds, "edit")).toBe(false)
    })

    test("refuses another member, even with edit access", () => {
      expect(canActOnStep(assignedToMember("mem_someone_else"), editor, teamIds, "edit")).toBe(false)
    })
  })

  describe("a step assigned to a group", () => {
    test.each(teamIds)("lets a member of the group act, for %s", (teamId) => {
      expect(canActOnStep(assignedToTeam(teamId), editor, teamIds, null)).toBe(true)
    })

    test("refuses a member who isn't in the group, even with edit access", () => {
      expect(canActOnStep(assignedToTeam("team_not_mine"), editor, teamIds, "edit")).toBe(false)
    })

    test("refuses a member who isn't in any group", () => {
      expect(canActOnStep(assignedToTeam("team_mine"), editor, [], "edit")).toBe(false)
    })
  })

  describe("a step assigned to a role", () => {
    test("lets a member with that role act", () => {
      expect(canActOnStep(assignedToRole("editor"), editor, [], null)).toBe(true)
    })

    test("lets a member with several roles act when one of them matches", () => {
      expect(canActOnStep(assignedToRole("editor"), member("viewer, editor"), [], null)).toBe(true)
    })

    test.each(["owner", "admin", "viewer"])("refuses a member with only the %s role, since roles match exactly", (role) => {
      expect(canActOnStep(assignedToRole("editor"), member(role), [], "edit")).toBe(false)
    })
  })

  describe("an unassigned step", () => {
    test.each(["run", "edit"] as const)("lets a member with %s access act", (level) => {
      expect(canActOnStep(unassigned, editor, teamIds, level)).toBe(true)
    })

    test("refuses a member with only view access", () => {
      expect(canActOnStep(unassigned, editor, teamIds, "view")).toBe(false)
    })

    test("refuses a member with no access to the template", () => {
      expect(canActOnStep(unassigned, editor, teamIds, null)).toBe(false)
    })
  })

  describe("a step whose assignee was removed", () => {
    test.each([
      ["member", assignedToMember(null)],
      ["group", assignedToTeam(null)],
      ["role", assignedToRole(null)],
    ])("refuses everyone when the assigned %s is gone, even with edit access", (_kind, step) => {
      expect(canActOnStep(step, editor, teamIds, "edit")).toBe(false)
      expect(canActOnStep(step, member("owner"), teamIds, "edit")).toBe(false)
    })
  })
})
