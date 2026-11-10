import { describe, expect, test } from "vitest"

import { fieldOptionsSchema } from "@checklog/shared/domain"

function issuePaths(options: unknown) {
  const result = fieldOptionsSchema.safeParse(options)
  return result.success ? [] : result.error.issues.map(issue => issue.path)
}

describe("fieldOptionsSchema", () => {
  describe("text", () => {
    test.each([
      ["no limits", { type: "text", multiLine: false }],
      ["equal limits", { type: "text", multiLine: false, minLength: 5, maxLength: 5 }],
      ["a minimum below the maximum", { type: "text", multiLine: true, minLength: 1, maxLength: 10 }],
      ["only a minimum", { type: "text", multiLine: false, minLength: 3 }],
    ])("accepts %s", (_, options) => {
      expect(fieldOptionsSchema.safeParse(options).success).toBe(true)
    })

    test("refuses a minimum length above the maximum, on minLength", () => {
      expect(issuePaths({ type: "text", multiLine: false, minLength: 10, maxLength: 5 })).toEqual([["minLength"]])
    })

    test.each([
      ["a negative minimum", { minLength: -1 }],
      ["a fractional maximum", { maxLength: 2.5 }],
    ])("refuses %s", (_, limits) => {
      expect(fieldOptionsSchema.safeParse({ type: "text", multiLine: false, ...limits }).success).toBe(false)
    })
  })

  describe("number", () => {
    test.each([
      ["no limits", { type: "number" }],
      ["equal limits", { type: "number", min: 5, max: 5 }],
      ["negative limits", { type: "number", min: -10, max: -1 }],
      ["only a maximum", { type: "number", max: 3 }],
    ])("accepts %s", (_, options) => {
      expect(fieldOptionsSchema.safeParse(options).success).toBe(true)
    })

    test("refuses a minimum above the maximum, on min", () => {
      expect(issuePaths({ type: "number", min: 10, max: 5 })).toEqual([["min"]])
    })

    test("refuses negative decimal places", () => {
      expect(fieldOptionsSchema.safeParse({ type: "number", decimalPlaces: -1 }).success).toBe(false)
    })
  })

  test.each([
    ["dropdown", { type: "dropdown", choices: [{ value: "a", label: "A" }], multiple: false }],
    ["date", { type: "date", dateType: "datetime", allowFuture: true }],
    ["checkbox", { type: "checkbox" }],
  ])("accepts %s options", (_, options) => {
    expect(fieldOptionsSchema.safeParse(options).success).toBe(true)
  })

  test("refuses an unknown date type", () => {
    expect(fieldOptionsSchema.safeParse({ type: "date", dateType: "week", allowFuture: true }).success).toBe(false)
  })

  test("refuses an unknown field type", () => {
    expect(fieldOptionsSchema.safeParse({ type: "file" }).success).toBe(false)
  })
})
