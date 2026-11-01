import { describe, expectTypeOf, test } from "vitest"
import { z } from "zod"

import { route } from "./route.ts"

describe("route() input types", () => {
  test("gives the handler each schema's output type", () => {
    route({
      params: z.object({ id: z.string() }),
      query: z.object({ page: z.coerce.number().default(1) }),
    }, (input) => {
      expectTypeOf(input.params).toEqualTypeOf<{ id: string }>()
      expectTypeOf(input.query).toEqualTypeOf<{ page: number }>()
    })
  })

  test("leaves out the parts without a schema", () => {
    route({ body: z.object({ name: z.string() }) }, (input) => {
      expectTypeOf(input).toEqualTypeOf<{ body: { name: string } }>()
    })
  })
})
