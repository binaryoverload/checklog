import { describe, expect, expectTypeOf, test } from "vitest"
import { z } from "zod"

import { paginationQuerySchema } from "@checklog/shared/api"
import type { Paginated } from "@checklog/shared/api"

describe("paginationQuerySchema", () => {
  test("defaults to a maximum and default limit of 100", () => {
    const schema = paginationQuerySchema()

    expect(schema.parse({})).toEqual({ limit: 100 })
    expect(schema.safeParse({ limit: "100" }).success).toBe(true)
    expect(schema.safeParse({ limit: "101" }).success).toBe(false)
  })

  test("defaults the limit to the maximum when only the maximum is given", () => {
    expect(paginationQuerySchema(50).parse({})).toEqual({ limit: 50 })
  })

  test("uses the given default limit", () => {
    expect(paginationQuerySchema(100, 25).parse({})).toEqual({ limit: 25 })
  })

  test("coerces the limit from a query string", () => {
    expect(paginationQuerySchema().parse({ limit: "10" }).limit).toBe(10)
  })

  test("accepts limits from 1 to the maximum", () => {
    const schema = paginationQuerySchema(50, 20)

    expect(schema.parse({ limit: "1" }).limit).toBe(1)
    expect(schema.parse({ limit: "50" }).limit).toBe(50)
  })

  test.each(["0", "51", "-5", "2.5", "ten", ""])("rejects a limit of %j", (limit) => {
    expect(paginationQuerySchema(50, 20).safeParse({ limit }).success).toBe(false)
  })

  test("passes the cursor through unchanged", () => {
    expect(paginationQuerySchema().parse({ cursor: "abc_DEF-123" }).cursor).toBe("abc_DEF-123")
  })

  test("leaves the cursor out when there isn't one", () => {
    expect(paginationQuerySchema().parse({ limit: "5" })).not.toHaveProperty("cursor")
  })

  test("keeps its defaults when extended with an area's filters", () => {
    const listRunsQuerySchema = paginationQuerySchema(100, 25).extend({ scope: z.enum(["mine", "groups", "all"]) })

    expect(listRunsQuerySchema.parse({ scope: "mine" })).toEqual({ scope: "mine", limit: 25 })
  })

  test("always outputs a limit", () => {
    expectTypeOf<z.output<ReturnType<typeof paginationQuerySchema>>>().toEqualTypeOf<{
      limit: number
      cursor?: string | undefined
    }>()
  })
})

describe("Paginated", () => {
  test("has items, a nullable next cursor and a total", () => {
    expectTypeOf<Paginated<{ id: string }>>().toEqualTypeOf<{
      items: { id: string }[]
      nextCursor: string | null
      total: number
    }>()
  })
})
