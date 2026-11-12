import { describe, expect, test } from "vitest"

import { highestTemplateAccessLevel, templateAccessIncludes, templateStepRuleIssues, templateVersionPublishIssues } from "@checklog/shared/domain"
import type { FieldOptions, PreconditionIssue, TemplateAccessLevel } from "@checklog/shared/domain"

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

type StepProblem = Extract<PreconditionIssue, { resourceType: "templateStep" }>["problem"]

describe("templateVersionPublishIssues", () => {
  const versionId = "tver_draft"
  const unassigned = { id: "tstep_unassigned", assigneeType: null, assignee: null }
  const assigned = { id: "tstep_assigned", assigneeType: "member", assignee: { type: "member", memberId: "member_1" } } as const
  const missing = { id: "tstep_missing", assigneeType: "team", assignee: null } as const

  const field = (id: string, templateStepId: string, options: FieldOptions) => ({ id, templateStepId, options })
  const emptyDropdown: FieldOptions = { type: "dropdown", choices: [], multiple: false }
  const dropdown: FieldOptions = { type: "dropdown", choices: [{ value: "ok", label: "OK" }], multiple: true }

  const stepProblem = (problem: StepProblem, stepId: string, fieldId: string | null = null) =>
    ({
      location: "resource",
      resourceType: "templateStep",
      problem,
      stepId,
      fieldId,
      message: expect.any(String),
    })

  test("allows assigned and unassigned steps with fields of every type", () => {
    expect(templateVersionPublishIssues(versionId, [unassigned, assigned], [
      field("tfield_text", unassigned.id, { type: "text", multiLine: false }),
      field("tfield_number", unassigned.id, { type: "number" }),
      field("tfield_date", assigned.id, { type: "date", dateType: "date", allowFuture: true }),
      field("tfield_checkbox", assigned.id, { type: "checkbox" }),
      field("tfield_dropdown", assigned.id, dropdown),
    ])).toEqual([])
  })

  test("refuses a version with no steps, pointing at the version", () => {
    expect(templateVersionPublishIssues(versionId, [], [])).toEqual([
      { location: "resource", resourceType: "templateVersion", problem: "no_steps", versionId, message: expect.any(String) },
    ])
  })

  test("refuses a step whose assignee type is set but whose assignee is gone", () => {
    expect(templateVersionPublishIssues(versionId, [missing], [])).toEqual([stepProblem("missing_assignee", missing.id)])
  })

  test("refuses a dropdown with no choices, pointing at its step and field", () => {
    expect(templateVersionPublishIssues(versionId, [unassigned], [field("tfield_empty", unassigned.id, emptyDropdown)])).toEqual([
      stepProblem("dropdown_without_choices", unassigned.id, "tfield_empty"),
    ])
  })

  test("reports every problem at once", () => {
    expect(templateVersionPublishIssues(versionId, [missing, unassigned], [
      field("tfield_first", unassigned.id, emptyDropdown),
      field("tfield_second", missing.id, emptyDropdown),
      field("tfield_fine", unassigned.id, dropdown),
    ])).toEqual([
      stepProblem("missing_assignee", missing.id),
      stepProblem("dropdown_without_choices", unassigned.id, "tfield_first"),
      stepProblem("dropdown_without_choices", missing.id, "tfield_second"),
    ])
  })
})
