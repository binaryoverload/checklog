import { describe, expect, test } from "vitest"

import { allStepsResolved, blockedStepIds, isEmptyFieldValue, missingRequiredFields } from "@checklog/shared/domain"
import type { FieldValue, RunStepStatus } from "@checklog/shared/domain"

// Steps in template order, named a, b, c… so the expected sets read easily
function steps(...specs: [isHalt: boolean, status: RunStepStatus][]) {
  return specs.map(([isHalt, status], index) => ({ id: String.fromCharCode(97 + index), isHalt, status }))
}

describe("blockedStepIds", () => {
  test("blocks nothing when there are no halt steps", () => {
    expect(blockedStepIds(steps([false, "pending"], [false, "pending"]))).toEqual(new Set())
  })

  test("blocks every step after a pending halt step, but not the halt step itself", () => {
    expect(blockedStepIds(steps([false, "pending"], [true, "pending"], [false, "pending"], [false, "completed"]))).toEqual(new Set(["c", "d"]))
  })

  test("blocks nothing after a completed halt step", () => {
    expect(blockedStepIds(steps([true, "completed"], [false, "pending"]))).toEqual(new Set())
  })

  test("doesn't treat a skipped halt step as pending", () => {
    expect(blockedStepIds(steps([true, "skipped"], [false, "pending"]))).toEqual(new Set())
  })

  test("blocks from the first pending halt step when there are several", () => {
    expect(blockedStepIds(steps([true, "completed"], [false, "pending"], [true, "pending"], [true, "pending"], [false, "pending"])))
      .toEqual(new Set(["d", "e"]))
  })

  test("blocks a halt step that comes after another pending halt step", () => {
    expect(blockedStepIds(steps([true, "pending"], [true, "pending"]))).toEqual(new Set(["b"]))
  })

  test("blocks nothing for a run with no steps", () => {
    expect(blockedStepIds([])).toEqual(new Set())
  })
})

describe("isEmptyFieldValue", () => {
  test.each<[string, FieldValue | null]>([
    ["no value", null],
    ["empty text", { type: "text", value: "" }],
    ["text that's only spaces and line breaks", { type: "text", value: "  \n " }],
    ["a dropdown with no choices", { type: "dropdown", values: [] }],
  ])("counts %s as empty", (_description, value) => {
    expect(isEmptyFieldValue(value)).toBe(true)
  })

  test.each<[string, FieldValue]>([
    ["text", { type: "text", value: "Fine" }],
    ["the number 0", { type: "number", value: 0 }],
    ["an unticked checkbox", { type: "checkbox", value: false }],
    ["a dropdown with a choice", { type: "dropdown", values: ["pass"] }],
    ["a date", { type: "date", dateType: "date", value: "2026-11-13" }],
  ])("counts %s as filled in", (_description, value) => {
    expect(isEmptyFieldValue(value)).toBe(false)
  })
})

describe("missingRequiredFields", () => {
  const field = (id: string, required: boolean) => ({ id, required })
  const value = (templateFieldId: string, fieldValue: FieldValue | null) => ({ templateFieldId, value: fieldValue })

  test("returns nothing when every required field has a value", () => {
    expect(missingRequiredFields([field("a", true), field("b", true)], [
      value("a", { type: "number", value: 1 }),
      value("b", { type: "checkbox", value: false }),
    ])).toEqual([])
  })

  test("returns a required field with no value row", () => {
    expect(missingRequiredFields([field("a", true)], [])).toEqual([field("a", true)])
  })

  test("returns a required field whose value was cleared", () => {
    expect(missingRequiredFields([field("a", true)], [value("a", null)])).toEqual([field("a", true)])
  })

  test.each<[string, FieldValue]>([
    ["blank text", { type: "text", value: " " }],
    ["no dropdown choices", { type: "dropdown", values: [] }],
  ])("returns a required field with %s", (_description, fieldValue) => {
    expect(missingRequiredFields([field("a", true)], [value("a", fieldValue)])).toEqual([field("a", true)])
  })

  test("never returns an optional field, however empty", () => {
    expect(missingRequiredFields([field("a", false), field("b", false), field("c", false)], [
      value("b", { type: "text", value: "" }),
      value("c", { type: "dropdown", values: [] }),
    ])).toEqual([])
  })

  test("returns every missing field, in the order given, with its own properties", () => {
    const fields = [{ ...field("first", true), key: "first" }, field("filled", true), { ...field("second", true), key: "second" }]

    expect(missingRequiredFields(fields, [value("filled", { type: "number", value: 2 })])).toEqual([fields[0], fields[2]])
  })

  test("ignores values for other fields", () => {
    expect(missingRequiredFields([field("a", true)], [value("b", { type: "number", value: 1 })])).toEqual([field("a", true)])
  })
})

describe("allStepsResolved", () => {
  const withStatuses = (...statuses: RunStepStatus[]) => statuses.map(status => ({ status }))

  test("is true when every step is completed or skipped", () => {
    expect(allStepsResolved(withStatuses("completed", "skipped", "completed"))).toBe(true)
  })

  test("is false while any step is pending", () => {
    expect(allStepsResolved(withStatuses("completed", "pending", "skipped"))).toBe(false)
  })

  test("is true for a run with no steps", () => {
    expect(allStepsResolved([])).toBe(true)
  })
})
