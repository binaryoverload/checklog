import { describe, expect, test } from "vitest"

import { fieldOptionsSchema, fieldValueSchema, validateFieldValue } from "@checklog/shared/domain"
import type { FieldOptions, FieldValue } from "@checklog/shared/domain"

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

  test("accepts a text pattern that compiles", () => {
    expect(issuePaths({ type: "text", multiLine: false, pattern: "^[A-Z]{3}$" })).toEqual([])
  })

  test("refuses a text pattern that doesn't compile, on pattern", () => {
    expect(issuePaths({ type: "text", multiLine: false, pattern: "[" })).toEqual([["pattern"]])
  })

  test("refuses an unknown field type", () => {
    expect(fieldOptionsSchema.safeParse({ type: "file" }).success).toBe(false)
  })
})

describe("fieldValueSchema", () => {
  test.each([
    ["a date", { type: "date", dateType: "date", value: "2026-11-13" }],
    ["29 February in a leap year", { type: "date", dateType: "date", value: "2028-02-29" }],
    ["a datetime in UTC", { type: "date", dateType: "datetime", value: "2026-11-13T10:00:00Z" }],
    ["a datetime with an offset", { type: "date", dateType: "datetime", value: "2026-11-13T10:00:00+01:00" }],
    ["a time in hours and minutes", { type: "date", dateType: "time", value: "16:21" }],
    ["a time with seconds", { type: "date", dateType: "time", value: "16:21:30" }],
  ])("accepts %s", (_description, value) => {
    expect(fieldValueSchema.safeParse(value).success).toBe(true)
  })

  test.each([
    ["a date that doesn't exist", { type: "date", dateType: "date", value: "2026-02-30" }],
    ["29 February outside a leap year", { type: "date", dateType: "date", value: "2026-02-29" }],
    ["a date in another format", { type: "date", dateType: "date", value: "13/11/2026" }],
    ["a datetime without a time zone", { type: "date", dateType: "datetime", value: "2026-11-13T10:00:00" }],
    ["a date given as a datetime", { type: "date", dateType: "datetime", value: "2026-11-13" }],
    ["a time that doesn't exist", { type: "date", dateType: "time", value: "25:00" }],
    ["a date given as a time", { type: "date", dateType: "time", value: "2026-11-13" }],
    ["an unknown date type", { type: "date", dateType: "week", value: "2026-W46" }],
  ])("refuses %s", (_description, value) => {
    expect(fieldValueSchema.safeParse(value).success).toBe(false)
  })
})

describe("validateFieldValue", () => {
  const now = { date: "2026-11-13", datetime: new Date("2026-11-13T12:00:00Z") }
  const validate = (options: FieldOptions, value: FieldValue | null) => validateFieldValue(options, value, now)
  const paths = (options: FieldOptions, value: FieldValue | null) => validate(options, value).map(issue => issue.path)

  const text: FieldOptions = { type: "text", multiLine: false }
  const number: FieldOptions = { type: "number" }
  const checkbox: FieldOptions = { type: "checkbox" }
  const dropdown: FieldOptions = { type: "dropdown", choices: [{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }], multiple: false }

  test("accepts no value for any type of field", () => {
    for (const options of [text, number, checkbox, dropdown]) expect(validate(options, null)).toEqual([])
  })

  test.each<[string, FieldOptions, FieldValue]>([
    ["a text field", number, { type: "text", value: "4" }],
    ["a number field", text, { type: "number", value: 4 }],
    ["a checkbox field", text, { type: "checkbox", value: true }],
    ["a dropdown field", text, { type: "dropdown", values: ["pass"] }],
    ["a date field", text, { type: "date", dateType: "date", value: "2026-11-13" }],
  ])("refuses a value of the wrong type for %s, on type", (_description, options, value) => {
    expect(paths(options, value)).toEqual([["type"]])
  })

  describe("text", () => {
    test("accepts text with no limits", () => {
      expect(validate(text, { type: "text", value: "Anything at all" })).toEqual([])
    })

    test("refuses a line break in a single-line field, and accepts it in a multi-line one", () => {
      expect(paths(text, { type: "text", value: "Two\nlines" })).toEqual([["value"]])
      expect(validate({ type: "text", multiLine: true }, { type: "text", value: "Two\nlines" })).toEqual([])
    })

    test.each([
      ["at the maximum length", "abc", []],
      ["over the maximum length", "abcd", [["value"]]],
    ])("checks text %s", (_description, value, expected) => {
      expect(paths({ type: "text", multiLine: false, maxLength: 3 }, { type: "text", value })).toEqual(expected)
    })

    test("refuses any text when the maximum length is 0", () => {
      expect(paths({ type: "text", multiLine: false, maxLength: 0 }, { type: "text", value: "a" })).toEqual([["value"]])
    })

    test.each([
      ["at the minimum length", "abc", []],
      ["under the minimum length", "ab", [["value"]]],
    ])("checks text %s", (_description, value, expected) => {
      expect(paths({ type: "text", multiLine: false, minLength: 3 }, { type: "text", value })).toEqual(expected)
    })

    test.each([
      ["text matching the pattern", "^[A-Z]+$", "ABC", []],
      ["text not matching the pattern", "^[A-Z]+$", "AbC", [["value"]]],
      ["text containing an unanchored pattern without matching it all", "[0-9]+", "abc123def", [["value"]]],
      ["text matching an unanchored pattern in full", "[0-9]+", "123", []],
      ["text matching only one side of an alternation", "a|b", "ab", [["value"]]],
    ])("checks %s", (_description, pattern, value, expected) => {
      expect(paths({ type: "text", multiLine: false, pattern }, { type: "text", value })).toEqual(expected)
    })
  })

  describe("number", () => {
    test.each([
      ["at the minimum", 0, []],
      ["below the minimum", -1, [["value"]]],
      ["at the maximum", 10, []],
      ["above the maximum", 10.5, [["value"]]],
    ])("checks a number %s", (_description, value, expected) => {
      expect(paths({ type: "number", min: 0, max: 10 }, { type: "number", value })).toEqual(expected)
    })

    test.each<[number, number, boolean]>([
      [1.1, 1, true],
      [10, 2, true],
      [-0.5, 1, true],
      [0.000001, 6, true],
      [2, 0, true],
      [2.5, 0, false],
      [3.14159, 2, false],
      [1.005, 2, false],
      [0.1 + 0.2, 1, false],
    ])("with %f and %i decimal places allowed, accepts it: %s", (value, decimalPlaces, accepted) => {
      expect(validate({ type: "number", decimalPlaces }, { type: "number", value })).toHaveLength(accepted ? 0 : 1)
    })
  })

  describe("checkbox", () => {
    test.each([true, false])("accepts %s", (value) => {
      expect(validate(checkbox, { type: "checkbox", value })).toEqual([])
    })
  })

  describe("dropdown", () => {
    test("accepts one of the choices", () => {
      expect(validate(dropdown, { type: "dropdown", values: ["pass"] })).toEqual([])
    })

    test("refuses a value that isn't one of the choices, on values", () => {
      expect(paths(dropdown, { type: "dropdown", values: ["maybe"] })).toEqual([["values"]])
    })

    test("refuses several choices when only one is allowed", () => {
      expect(paths(dropdown, { type: "dropdown", values: ["pass", "fail"] })).toEqual([["values"]])
    })

    test("accepts several choices when multiple are allowed", () => {
      expect(validate({ ...dropdown, multiple: true }, { type: "dropdown", values: ["pass", "fail"] })).toEqual([])
    })

    test("accepts a selection with no choices, leaving it to the required check", () => {
      expect(validate(dropdown, { type: "dropdown", values: [] })).toEqual([])
    })
  })

  describe("date", () => {
    const dateField = (dateType: "date" | "datetime" | "time", allowFuture: boolean): FieldOptions => ({ type: "date", dateType, allowFuture })

    test("refuses a value of another date type, on dateType", () => {
      expect(paths(dateField("date", true), { type: "date", dateType: "time", value: "16:21" })).toEqual([["dateType"]])
    })

    test.each([
      ["today", "2026-11-13", []],
      ["a past date", "2020-01-01", []],
      ["tomorrow", "2026-11-14", [["value"]]],
    ])("for a date field that doesn't allow future dates, checks %s", (_description, value, expected) => {
      expect(paths(dateField("date", false), { type: "date", dateType: "date", value })).toEqual(expected)
    })

    test("accepts a future date when future dates are allowed", () => {
      expect(validate(dateField("date", true), { type: "date", dateType: "date", value: "2099-01-01" })).toEqual([])
    })

    test("compares date values with today in the zone the caller works out, not UTC", () => {
      // 23:30 UTC on 13 November is already 14 November in Auckland, so a caller there passes that as today
      const auckland = { date: "2026-11-14", datetime: new Date("2026-11-13T23:30:00Z") }

      expect(validateFieldValue(dateField("date", false), { type: "date", dateType: "date", value: "2026-11-14" }, auckland)).toEqual([])
    })

    test.each([
      ["a moment before now", "2026-11-13T11:59:00Z", []],
      ["the same moment written with an offset", "2026-11-13T13:00:00+01:00", []],
      ["a moment after now", "2026-11-13T12:01:00Z", [["value"]]],
      ["a later moment written with an offset that looks earlier as text", "2026-11-13T11:30:00-01:00", [["value"]]],
    ])("for a datetime field that doesn't allow future times, checks %s", (_description, value, expected) => {
      expect(paths(dateField("datetime", false), { type: "date", dateType: "datetime", value })).toEqual(expected)
    })

    test("doesn't check time values against now, since they have no date", () => {
      expect(validate(dateField("time", false), { type: "date", dateType: "time", value: "23:59" })).toEqual([])
    })
  })

  test("reports every problem with a value at once", () => {
    const options: FieldOptions = { type: "text", multiLine: false, maxLength: 3, pattern: "^[0-9]+$" }

    expect(paths(options, { type: "text", value: "abcd\ne" })).toEqual([["value"], ["value"], ["value"]])
  })
})
