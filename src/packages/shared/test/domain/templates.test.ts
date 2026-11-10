import { describe, expect, test } from "vitest"

import { highestTemplateAccessLevel, templateAccessIncludes, templateStepRuleIssues } from "@checklog/shared/domain"
import type { TemplateAccessLevel } from "@checklog/shared/domain"

describe("templateAccessIncludes", () => {
  test.each<[TemplateAccessLevel, TemplateAccessLevel, boolean]>([
    ["view", "view", true],
    ["view", "run", false],
    ["view", "edit", false],
    ["run", "view", true],
    ["run", "run", true],
    ["run", "edit", false],
    ["edit", "view", true],
    ["edit", "run", true],
    ["edit", "edit", true],
  ])("%s includes %s: %s", (has, needs, expected) => {
    expect(templateAccessIncludes(has, needs)).toBe(expected)
  })
})

describe("highestTemplateAccessLevel", () => {
  test("returns null for no levels", () => {
    expect(highestTemplateAccessLevel([])).toBeNull()
  })

  test("returns the only level", () => {
    expect(highestTemplateAccessLevel(["run"])).toBe("run")
  })

  test.each<[TemplateAccessLevel[], TemplateAccessLevel]>([
    [["view", "run"], "run"],
    [["run", "view"], "run"],
    [["view", "edit", "run"], "edit"],
    [["edit", "view"], "edit"],
    [["view", "view"], "view"],
  ])("returns the highest of %j", (levels, expected) => {
    expect(highestTemplateAccessLevel(levels)).toBe(expected)
  })
})

describe("templateStepRuleIssues", () => {
  const assignee = { type: "role", role: "admin" } as const

  test.each([
    ["a task step", { kind: "task", isHalt: false, skippable: false }],
    ["a skippable task step", { kind: "task", isHalt: false, skippable: true }],
    ["a halt task step", { kind: "task", isHalt: true, skippable: false }],
    ["an assigned approval step", { kind: "approval", isHalt: false, skippable: false, assignee }],
    ["an assigned halt approval step", { kind: "approval", isHalt: true, skippable: false, assignee }],
  ] as const)("allows %s", (_, step) => {
    expect(templateStepRuleIssues(step)).toEqual([])
  })

  test.each([null, undefined])("refuses an approval step with an assignee of %s", (stepAssignee) => {
    expect(templateStepRuleIssues({ kind: "approval", isHalt: false, skippable: false, assignee: stepAssignee })).toEqual([
      { path: ["assignee"], message: "Approval steps must have an assignee" },
    ])
  })

  test("refuses a skippable approval step", () => {
    expect(templateStepRuleIssues({ kind: "approval", isHalt: false, skippable: true, assignee })).toEqual([
      { path: ["skippable"], message: "Approval steps cannot be skippable" },
    ])
  })

  test("refuses a skippable halt step", () => {
    expect(templateStepRuleIssues({ kind: "task", isHalt: true, skippable: true })).toEqual([
      { path: ["skippable"], message: "Halt steps cannot be skippable" },
    ])
  })

  test("reports every broken rule at once", () => {
    expect(templateStepRuleIssues({ kind: "approval", isHalt: true, skippable: true })).toEqual([
      { path: ["assignee"], message: "Approval steps must have an assignee" },
      { path: ["skippable"], message: "Approval steps cannot be skippable" },
      { path: ["skippable"], message: "Halt steps cannot be skippable" },
    ])
  })
})
