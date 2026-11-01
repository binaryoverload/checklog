import express from "express"
import request from "supertest"
import { describe, expect, test, vi } from "vitest"
import { z } from "zod"

import { errorHandler, notFound } from "./error-handling.ts"
import { HttpError } from "./errors.ts"
import { route } from "./route.ts"
import { logger } from "../core/logger.ts"

// A small app with the same middleware order as app.ts, without auth or the database
function testApp() {
  const app = express()
  app.use(express.json({ limit: "1kb" }))

  app.post("/items/:id", route({
    params: z.object({ id: z.string().startsWith("item_") }),
    query: z.object({ dryRun: z.stringbool().default(false) }),
    body: z.object({ name: z.string().min(1), count: z.number().int() }),
  }, ({ params, query, body }, _req, res) => {
    res.json({ params, query, body })
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
    logged.mockRestore()
  })
})
