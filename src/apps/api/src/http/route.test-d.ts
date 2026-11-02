import { describe, expectTypeOf, test } from "vitest"
import { z } from "zod"

import type { auth } from "@/core/auth.ts"
import type { members, organizations } from "@/db/auth-schema.ts"

import { route } from "./route.ts"

type Session = typeof auth.$Infer.Session
type Organization = typeof organizations.$inferSelect
type Member = typeof members.$inferSelect

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
      expectTypeOf(input.body).toEqualTypeOf<{ name: string }>()
      expectTypeOf(input).not.toHaveProperty("params")
      expectTypeOf(input).not.toHaveProperty("query")
    })
  })

  test("gives signed-in routes a session that can't be null", () => {
    route({}, ({ session }) => {
      expectTypeOf(session).toEqualTypeOf<Session>()
    })
  })

  test("gives public routes a session that can be null", () => {
    route({ auth: "public" }, ({ session }) => {
      expectTypeOf(session).toEqualTypeOf<Session | null>()
    })
  })

  test("leaves the auth option out of the context", () => {
    route({ auth: "public", organization: "none" }, (context) => {
      expectTypeOf(context).not.toHaveProperty("auth")
    })
  })

  test("gives routes an organization and member by default", () => {
    route({}, ({ organization, member }) => {
      expectTypeOf(organization).toEqualTypeOf<Organization>()
      expectTypeOf(member).toEqualTypeOf<Member>()
    })
  })

  test("gives routes that opt out no organization or member", () => {
    route({ organization: "none" }, ({ organization, member }) => {
      expectTypeOf(organization).toBeNull()
      expectTypeOf(member).toBeNull()
    })
  })

  test("gives public routes no organization or member", () => {
    route({ auth: "public" }, ({ organization, member }) => {
      expectTypeOf(organization).toBeNull()
      expectTypeOf(member).toBeNull()
    })
  })
})
