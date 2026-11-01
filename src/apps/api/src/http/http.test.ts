import express from "express"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { z } from "zod"

import { errorHandler, notFound } from "./error-handling.ts"
import { HttpError } from "./errors.ts"
import { route } from "./route.ts"
import { auth } from "../core/auth.ts"
import { logger } from "../core/logger.ts"
import { db } from "../db/index.ts"

const signedIn = {
  user: { id: "user_test", email: "test@example.com", name: "Test User" },
  session: { id: "sess_test", userId: "user_test", activeOrganizationId: "org_test" as string | null },
}

const membership = {
  id: "mem_test",
  organizationId: "org_test",
  userId: "user_test",
  role: "owner",
  organization: { id: "org_test", name: "Test Org", accountType: "personal", deletedAt: null },
}

// Session and membership lookups are stubbed, signed in to an organization by default, so nothing touches the database
let getSession: ReturnType<typeof vi.spyOn>
let findMember: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  getSession = vi.spyOn(auth.api, "getSession").mockResolvedValue(signedIn as never)
  findMember = vi.spyOn(db.query.members, "findFirst").mockResolvedValue(membership as never)
})

function signOut() {
  getSession.mockResolvedValue(null as never)
}

function withSession(session: Partial<typeof signedIn.session>) {
  getSession.mockResolvedValue({ ...signedIn, session: { ...signedIn.session, ...session } } as never)
}

afterEach(() => {
  vi.restoreAllMocks()
})

// A small app with the same middleware order as app.ts, without Better Auth's handler
function testApp() {
  const app = express()
  app.use(express.json({ limit: "1kb" }))

  app.post("/items/:id", route({
    params: z.object({ id: z.string().startsWith("item_") }),
    query: z.object({ dryRun: z.stringbool().default(false) }),
    body: z.object({ name: z.string().min(1), count: z.number().int() }),
  }, ({ params, query, body, res }) => {
    res.json({ params, query, body })
  }))

  app.get("/me", route({}, ({ session, res }) => {
    res.json({ userId: session.user.id })
  }))

  app.get("/public", route({ auth: "public" }, ({ session, organization, res }) => {
    res.json({ userId: session?.user.id ?? null, organization })
  }))

  app.get("/org", route({}, ({ organization, member, res }) => {
    res.json({ organization, member })
  }))

  app.get("/no-org", route({ organization: "none" }, ({ session, organization, member, res }) => {
    res.json({ userId: session.user.id, organization, member })
  }))

  app.get("/missing-thing", route({}, () => {
    throw new HttpError("not_found", "Thing not found")
  }))

  app.get("/broken", route({}, async () => {
    await Promise.resolve()
    throw new Error("database password is hunter2")
  }))

  app.use(notFound)
  app.use(errorHandler)
  return app
}

describe("route()", () => {
  test("passes parsed params, query and body to the handler", async () => {
    const res = await request(testApp())
      .post("/items/item_1?dryRun=true")
      .send({ name: "Fridge check", count: 2 })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      params: { id: "item_1" },
      query: { dryRun: true },
      body: { name: "Fridge check", count: 2 },
    })
  })

  test("applies schema defaults", async () => {
    const res = await request(testApp()).post("/items/item_1").send({ name: "a", count: 1 })

    expect(res.body.query).toEqual({ dryRun: false })
  })

  test("reports every invalid part in one validation_failed error", async () => {
    const res = await request(testApp())
      .post("/items/wrong?dryRun=maybe")
      .send({ name: "", count: 1.5 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe("validation_failed")
    expect(res.body.error.details.map((d: { location: string, path: unknown[] }) => [d.location, d.path])).toEqual([
      ["params", ["id"]],
      ["query", ["dryRun"]],
      ["body", ["name"]],
      ["body", ["count"]],
    ])
  })

  test("treats a missing body as invalid", async () => {
    const res = await request(testApp()).post("/items/item_1")

    expect(res.status).toBe(400)
    expect(res.body.error.details[0].location).toBe("body")
  })
})

describe("route() sessions", () => {
  test("passes the signed-in session to the handler", async () => {
    const res = await request(testApp()).get("/me")

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ userId: "user_test" })
    expect(getSession).toHaveBeenCalledOnce()
  })

  test("rejects a signed-out request with unauthorized", async () => {
    signOut()

    const res = await request(testApp()).get("/me")

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe("unauthorized")
  })

  test("checks sign-in before validating input", async () => {
    signOut()

    const res = await request(testApp()).post("/items/wrong").send({})

    expect(res.status).toBe(401)
    expect(res.body.error.details).toBeUndefined()
  })

  test("lets a signed-out request through to a public route with no session", async () => {
    signOut()

    const res = await request(testApp()).get("/public")

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ userId: null, organization: null })
  })

  test("still passes the session to a public route when signed in, without loading an organization", async () => {
    const res = await request(testApp()).get("/public")

    expect(res.body).toEqual({ userId: "user_test", organization: null })
    expect(findMember).not.toHaveBeenCalled()
  })
})

describe("route() organizations", () => {
  test("passes the active organization and member to the handler", async () => {
    const res = await request(testApp()).get("/org")

    expect(res.status).toBe(200)
    expect(res.body.organization).toEqual(membership.organization)
    expect(res.body.member).toMatchObject({ id: "mem_test", role: "owner" })
  })

  test("keeps the organization out of the member", async () => {
    const res = await request(testApp()).get("/org")

    expect(res.body.member).not.toHaveProperty("organization")
  })

  test("rejects a session with no active organization", async () => {
    withSession({ activeOrganizationId: null })

    const res = await request(testApp()).get("/org")

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe("no_active_organization")
    expect(findMember).not.toHaveBeenCalled()
  })

  test("rejects a user who is no longer a member of the active organization", async () => {
    findMember.mockResolvedValue(undefined as never)

    const res = await request(testApp()).get("/org")

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe("forbidden")
  })

  test("rejects a deleted organization", async () => {
    findMember.mockResolvedValue({
      ...membership,
      organization: { ...membership.organization, deletedAt: new Date() },
    } as never)

    const res = await request(testApp()).get("/org")

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe("organization_deleted")
  })

  test("checks the organization before validating input", async () => {
    withSession({ activeOrganizationId: null })

    const res = await request(testApp()).post("/items/wrong").send({})

    expect(res.body.error.code).toBe("no_active_organization")
  })

  test("skips the organization for a route that opts out", async () => {
    withSession({ activeOrganizationId: null })

    const res = await request(testApp()).get("/no-org")

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ userId: "user_test", organization: null, member: null })
    expect(findMember).not.toHaveBeenCalled()
  })
})

describe("error handling", () => {
  test("sends a thrown HttpError with its status and code", async () => {
    const res = await request(testApp()).get("/missing-thing")

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: { code: "not_found", message: "Thing not found" } })
  })

  test("answers unknown routes with not_found JSON", async () => {
    const res = await request(testApp()).get("/nope?token=abc")

    expect(res.status).toBe(404)
    expect(res.headers["content-type"]).toMatch(/application\/json/)
    expect(res.body).toEqual({ error: { code: "not_found", message: "No route for GET /nope" } })
  })

  test("turns malformed JSON into invalid_json", async () => {
    const res = await request(testApp())
      .post("/items/item_1")
      .set("Content-Type", "application/json")
      .send("{\"name\":")

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe("invalid_json")
  })

  test("turns an oversized body into payload_too_large", async () => {
    const res = await request(testApp())
      .post("/items/item_1")
      .send({ name: "x".repeat(2000), count: 1 })

    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe("payload_too_large")
  })

  test("logs unexpected errors and hides their details from the client", async () => {
    const logged = vi.spyOn(logger, "error").mockImplementation(() => logger)

    const res = await request(testApp()).get("/broken")

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: { code: "internal", message: "Something went wrong" } })
    expect(JSON.stringify(res.body)).not.toContain("hunter2")
    expect(logged).toHaveBeenCalledOnce()
  })
})
