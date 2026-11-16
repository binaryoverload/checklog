import { describe, expect, expectTypeOf, test } from "vitest"
import { z } from "zod"

import { cursorQuerySchema, pageQuerySchema } from "@checklog/shared/api"
import type { CursorResult, PageResult } from "@checklog/shared/api"

// Both schemas share the same limit rules
describe.each([
  ["pageQuerySchema", pageQuerySchema],
  ["cursorQuerySchema", cursorQuerySchema],
])("%s limit", (_name, schemaFor) => {
  test("defaults to a maximum and default limit of 100", () => {
    const schema = schemaFor()

    expect(schema.parse({}).limit).toBe(100)
    expect(schema.safeParse({ limit: "100" }).success).toBe(true)
    expect(schema.safeParse({ limit: "101" }).success).toBe(false)
  })

  test("defaults the limit to the maximum when only the maximum is given", () => {
    expect(schemaFor(50).parse({}).limit).toBe(50)
  })

  test("uses the given default limit", () => {
    expect(schemaFor(100, 25).parse({}).limit).toBe(25)
  })

  test("coerces the limit from a query string", () => {
    expect(schemaFor().parse({ limit: "10" }).limit).toBe(10)
  })

  test("accepts limits from 1 to the maximum", () => {
    const schema = schemaFor(50, 20)

    expect(schema.parse({ limit: "1" }).limit).toBe(1)
    expect(schema.parse({ limit: "50" }).limit).toBe(50)
  })

  test.each(["0", "51", "-5", "2.5", "ten", ""])("rejects a limit of %j", (limit) => {
    expect(schemaFor(50, 20).safeParse({ limit }).success).toBe(false)
  })
})

describe("pageQuerySchema", () => {
  test("defaults to the first page", () => {
    expect(pageQuerySchema().parse({})).toEqual({ page: 1, limit: 100 })
  })

  test("coerces the page from a query string", () => {
    expect(pageQuerySchema().parse({ page: "3" }).page).toBe(3)
  })

  test.each(["0", "-1", "1.5", "next", ""])("rejects a page of %j", (page) => {
    expect(pageQuerySchema().safeParse({ page }).success).toBe(false)
  })

  test("keeps its defaults when extended with an area's filters", () => {
    const listRunsQuerySchema = pageQuerySchema(100, 25).extend({ scope: z.enum(["mine", "groups", "all"]) })

    expect(listRunsQuerySchema.parse({ scope: "mine" })).toEqual({ scope: "mine", page: 1, limit: 25 })
  })

  test("always outputs a page and a limit", () => {
    expectTypeOf<z.output<ReturnType<typeof pageQuerySchema>>>().toEqualTypeOf<{
      page: number
      limit: number
    }>()
  })
})

describe("cursorQuerySchema", () => {
  test("passes the cursor through unchanged", () => {
    expect(cursorQuerySchema().parse({ cursor: "abc_DEF-123" }).cursor).toBe("abc_DEF-123")
  })

  test("leaves the cursor out when there isn't one", () => {
    expect(cursorQuerySchema().parse({ limit: "5" })).not.toHaveProperty("cursor")
  })

  test("always outputs a limit", () => {
    expectTypeOf<z.output<ReturnType<typeof cursorQuerySchema>>>().toEqualTypeOf<{
      limit: number
      cursor?: string | undefined
    }>()
  })
})

describe("PageResult", () => {
  test("has items, a total, the page and the limit", () => {
    expectTypeOf<PageResult<{ id: string }>>().toEqualTypeOf<{
      items: { id: string }[]
      total: number
      page: number
      limit: number
    }>()
  })
})

describe("CursorResult", () => {
  test("has items and a nullable next cursor", () => {
    expectTypeOf<CursorResult<{ id: string }>>().toEqualTypeOf<{
      items: { id: string }[]
      nextCursor: string | null
    }>()
  })
})
