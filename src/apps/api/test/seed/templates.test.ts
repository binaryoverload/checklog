import { describe, expect, test } from "vitest"

import { templateDefinitions } from "@/seed/templates.ts"
import { templateFieldCreateBodySchema, templateStepCreateBodySchema } from "@checklog/shared/api"
import { templateStepRuleIssues, templateVersionPublishIssues } from "@checklog/shared/domain"
import type { Assignee } from "@checklog/shared/domain"

// The seed inserts rows directly, so these check its data against the rules the API applies to the same data.
// A seeded assignee becomes a real member, group or role at seed time; any stands in for it here.
const placeholderAssignee: Assignee = { type: "role", role: "editor" }

const versions = templateDefinitions.flatMap(template =>
  template.versions.map((version, index) => ({ template, version, label: `${template.name} v${index + 1} (${version.status})` })))

describe("seeded templates", () => {
  test("have unique names", () => {
    const names = templateDefinitions.map(template => template.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test.each(templateDefinitions.map(template => [template.name, template] as const))("%s has at most one draft, and it's the last version", (_name, template) => {
    const draftIndexes = template.versions.flatMap((version, index) => (version.status === "draft" ? [index] : []))
    expect(draftIndexes.length).toBeLessThanOrEqual(1)
    if (draftIndexes.length === 1) expect(draftIndexes[0]).toBe(template.versions.length - 1)
  })

  describe.each(versions.map(entry => [entry.label, entry] as const))("%s", (_label, { version }) => {
    test("has steps the step rules allow", () => {
      for (const step of version.steps) {
        const assignee = step.assignee ? placeholderAssignee : null
        const kind = step.kind ?? "task"
        const isHalt = step.isHalt ?? false
        const skippable = step.skippable ?? false

        expect(templateStepRuleIssues({ kind, isHalt, skippable, assignee }), step.title).toEqual([])
        expect(templateStepCreateBodySchema.safeParse({
          title: step.title,
          instructions: step.instructions,
          kind,
          isHalt,
          skippable,
          assignee,
          dueOffset: step.dueOffset,
        }).error?.issues ?? [], step.title).toEqual([])
      }
    })

    test("has fields the field schema accepts, with keys unique within the version", () => {
      const fields = version.steps.flatMap(step => step.fields ?? [])

      for (const field of fields) {
        expect(templateFieldCreateBodySchema.safeParse(field).error?.issues ?? [], field.key).toEqual([])
      }
      const keys = fields.map(field => field.key)
      expect(new Set(keys).size).toBe(keys.length)
    })

    if (version.status !== "draft") {
      test("passes the publish check", () => {
        const steps = version.steps.map((step, index) => ({
          id: `step_${index}`,
          assigneeType: step.assignee ? placeholderAssignee.type : null,
          assignee: step.assignee ? placeholderAssignee : null,
        }))
        const fields = version.steps.flatMap((step, index) =>
          (step.fields ?? []).map(field => ({ id: field.key, templateStepId: `step_${index}`, options: field.options })))

        expect(templateVersionPublishIssues("version", steps, fields)).toEqual([])
      })
    }
  })
})
