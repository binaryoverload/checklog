import { describe, expect, test } from "vitest"

import { prefixForTable, typeIdForModel, typeIdForTable, typeIdParamsSchema, typeIdSchema } from "@checklog/shared/utils"

const suffix = "01h455vb4pex5vsknk084sn02q"

describe("typeIdForModel", () => {
  test("uses the model's prefix", () => {
    expect(typeIdForModel("organization").toString()).toMatch(/^org_/)
  })

  test("throws for an unknown model", () => {
    expect(() => typeIdForModel("widget")).toThrow("No typeid prefix found for model: widget")
  })
})

describe("typeIdForTable", () => {
  test("uses the table's prefix", () => {
    expect(typeIdForTable("templates").getType()).toBe(prefixForTable("templates"))
  })
})

describe("typeIdSchema", () => {
  const schema = typeIdSchema("templates")

  test("accepts a generated ID", () => {
    const id = typeIdForTable("templates").toString()

    expect(schema.parse(id)).toBe(id)
  })

  test.each([
    ["another table's prefix", `tver_${suffix}`],
    ["no prefix", suffix],
    ["an uppercase prefix", `TMPL_${suffix}`],
    ["an uppercase suffix", `tmpl_${suffix.toUpperCase()}`],
    ["a suffix starting above 7", `tmpl_8${suffix.slice(1)}`],
    ["a short suffix", `tmpl_${suffix.slice(1)}`],
    ["a long suffix", `tmpl_${suffix}0`],
    ["a letter outside the alphabet", `tmpl_${suffix.slice(0, -1)}u`],
    ["surrounding text", ` tmpl_${suffix}`],
  ])("rejects %s", (_, id) => {
    expect(schema.safeParse(id).success).toBe(false)
  })

  test("names the prefix in its error", () => {
    expect(schema.safeParse("nope").error?.issues[0]?.message).toBe("Must be a tmpl ID")
  })
})

describe("typeIdParamsSchema", () => {
  const schema = typeIdParamsSchema({ templateId: "templates", stepId: "templateSteps" })

  test("accepts each param with its own table's ID", () => {
    const params = { templateId: `tmpl_${suffix}`, stepId: `tstep_${suffix}` }

    expect(schema.parse(params)).toEqual(params)
  })

  test("rejects a param with another table's ID", () => {
    const result = schema.safeParse({ templateId: `tstep_${suffix}`, stepId: `tstep_${suffix}` })

    expect(result.error?.issues.map(issue => issue.path)).toEqual([["templateId"]])
  })

  test("rejects a missing param", () => {
    expect(schema.safeParse({ templateId: `tmpl_${suffix}` }).success).toBe(false)
  })
})
