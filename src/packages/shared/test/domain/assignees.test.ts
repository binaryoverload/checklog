import { describe, expect, test } from "vitest"

import { assigneeSchema, assigneeToFlat, flatToAssignee } from "@checklog/shared/domain"
import type { Assignee } from "@checklog/shared/domain"
import { typeIdForTable } from "@checklog/shared/utils"

const memberId = typeIdForTable("member").toString()
const teamId = typeIdForTable("team").toString()

const unassigned = { assigneeType: null, assigneeMemberId: null, assigneeTeamId: null, assigneeRole: null }

describe("assigneeSchema", () => {
  test.each<[string, Assignee]>([
    ["a member", { type: "member", memberId }],
    ["a team", { type: "team", teamId }],
    ["a role", { type: "role", role: "admin" }],
  ])("accepts %s", (_, assignee) => {
    expect(assigneeSchema.parse(assignee)).toEqual(assignee)
  })

  test.each([
    ["a member with a team ID", { type: "member", memberId: teamId }],
    ["a team with a member ID", { type: "team", teamId: memberId }],
    ["a member with an extra key", { type: "member", memberId, teamId }],
    ["a role without a role", { type: "role" }],
    ["an unknown type", { type: "group", groupId: teamId }],
  ])("rejects %s", (_, assignee) => {
    expect(assigneeSchema.safeParse(assignee).success).toBe(false)
  })
})

describe("assigneeToFlat", () => {
  test("clears every column when there is no assignee", () => {
    expect(assigneeToFlat(null)).toEqual(unassigned)
  })

  test("sets only the member column for a member", () => {
    expect(assigneeToFlat({ type: "member", memberId })).toEqual({ ...unassigned, assigneeType: "member", assigneeMemberId: memberId })
  })

  test("sets only the team column for a team", () => {
    expect(assigneeToFlat({ type: "team", teamId })).toEqual({ ...unassigned, assigneeType: "team", assigneeTeamId: teamId })
  })

  test("sets only the role column for a role", () => {
    expect(assigneeToFlat({ type: "role", role: "admin" })).toEqual({ ...unassigned, assigneeType: "role", assigneeRole: "admin" })
  })
})

describe("flatToAssignee", () => {
  test("returns null when there is no assignee type", () => {
    expect(flatToAssignee(unassigned)).toBeNull()
  })

  test.each<[string, Assignee]>([
    ["a member", { type: "member", memberId }],
    ["a team", { type: "team", teamId }],
    ["a role", { type: "role", role: "admin" }],
  ])("round-trips %s through assigneeToFlat", (_, assignee) => {
    expect(flatToAssignee(assigneeToFlat(assignee))).toEqual(assignee)
  })

  // A deleted member or team leaves the assignee type set and its column null
  test.each(["member", "team", "role"] as const)("returns null for a missing %s assignee", (assigneeType) => {
    expect(flatToAssignee({ ...unassigned, assigneeType })).toBeNull()
  })

  test("ignores the columns that don't match the type", () => {
    expect(flatToAssignee({ ...unassigned, assigneeType: "member", assigneeTeamId: teamId })).toBeNull()
  })
})
