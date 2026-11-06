import { describe, expect, test, vi } from "vitest"

import { templates } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { decodeCursor, encodeCursor, toPage } from "@/util/pagination.ts"
import type { SortDefinition } from "@/util/pagination.ts"

const id = "tmpl_01jc5x7m3pfq9a8b2c3d4e5f6g"

function expectBadRequest(action: () => unknown) {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).code).toBe("bad_request")
    return
  }
  expect.fail("expected a bad_request HttpError")
}

const base64url = (text: string) => Buffer.from(text).toString("base64url")

describe("encodeCursor and decodeCursor", () => {
  test("round trip a string sort value and ID", () => {
    expect(decodeCursor("name", encodeCursor("name", "Server checks", id))).toEqual({ value: "Server checks", id })
  })

  test("round trip a number sort value", () => {
    expect(decodeCursor("position", encodeCursor("position", 3, id))).toEqual({ value: 3, id })
  })

  test("round trip a date as a Date", () => {
    const createdAt = new Date("2026-11-06T19:29:00.123Z")
    const { value } = decodeCursor("created", encodeCursor("created", createdAt, id))

    expect(value).toBeInstanceOf(Date)
    expect((value as Date).getTime()).toBe(createdAt.getTime())
  })

  test("round trip an ID-only sort, whose value is null", () => {
    expect(decodeCursor("newest", encodeCursor("newest", null, id))).toEqual({ value: null, id })
  })

  test("round trip values with characters that need escaping", () => {
    const value = "Quotes \" and , commas / slashes + plus = equals"

    expect(decodeCursor("name", encodeCursor("name", value, id))).toEqual({ value, id })
  })

  test("produce URL-safe base64 with no padding", () => {
    expect(encodeCursor("name", "a?b&c=d", id)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test("don't show the ID or value in plain text", () => {
    const cursor = encodeCursor("name", "Server checks", id)

    expect(cursor).not.toContain(id)
    expect(cursor).not.toContain("Server")
  })

  test("reject a cursor made for a different sort", () => {
    const cursor = encodeCursor("name", "Server checks", id)

    expectBadRequest(() => decodeCursor("newest", cursor))
  })

  test.each([
    ["a string", "Server checks", { type: "string", value: "Server checks", sortKey: "name", id }],
    ["a number", 3, { type: "number", value: 3, sortKey: "name", id }],
    ["a date", new Date("2026-11-06T19:29:00.123Z"), { type: "date", value: "2026-11-06T19:29:00.123Z", sortKey: "name", id }],
    ["null", null, { type: "number", value: null, sortKey: "name", id }],
  ])("encode %s value as a typed JSON object", (_description, value, expected) => {
    const json = JSON.parse(Buffer.from(encodeCursor("name", value, id), "base64url").toString("utf-8"))

    expect(json).toEqual(expected)
  })

  test.each([
    ["a string", { type: "string", value: "Server checks", sortKey: "name", id }, "Server checks"],
    ["a number", { type: "number", value: 3, sortKey: "name", id }, 3],
    ["a null value", { type: "string", value: null, sortKey: "name", id }, null],
  ])("decode a hand-built cursor with %s", (_description, payload, value) => {
    expect(decodeCursor("name", base64url(JSON.stringify(payload)))).toEqual({ value, id })
  })

  test("keep an ISO date string sorted by name as a string", () => {
    const value = "2026-11-06T19:29:00.123Z"

    expect(decodeCursor("name", encodeCursor("name", value, id))).toEqual({ value, id })
  })

  const valid = { type: "string", value: "Server checks", sortKey: "name", id }
  const without = (key: keyof typeof valid) => Object.fromEntries(Object.entries(valid).filter(([entry]) => entry !== key))

  test.each([
    ["an empty string", ""],
    ["characters outside base64url", "not a cursor!"],
    ["base64url that isn't JSON", base64url("not json")],
    ["JSON that isn't an object", base64url(JSON.stringify(["string", "Server checks", "name", id]))],
    ["JSON null", base64url("null")],
    ["an object missing the ID", base64url(JSON.stringify(without("id")))],
    ["an object missing the sort key", base64url(JSON.stringify(without("sortKey")))],
    ["an object missing the type", base64url(JSON.stringify(without("type")))],
    ["an object missing the value", base64url(JSON.stringify(without("value")))],
    ["an ID that isn't a string", base64url(JSON.stringify({ ...valid, id: 42 }))],
    ["a sort key that isn't a string", base64url(JSON.stringify({ ...valid, sortKey: 7 }))],
    ["an unknown type", base64url(JSON.stringify({ ...valid, type: "boolean", value: true }))],
    ["a string value marked as a number", base64url(JSON.stringify({ ...valid, type: "number", value: "3" }))],
    ["a number value marked as a string", base64url(JSON.stringify({ ...valid, type: "string", value: 3 }))],
    ["a date value that isn't an ISO datetime", base64url(JSON.stringify({ ...valid, type: "date", value: "6 November 2026" }))],
  ])("reject %s", (_description, cursor) => {
    expectBadRequest(() => decodeCursor("name", cursor))
  })
})

type Row = { id: string, name: string }

const byName: SortDefinition<Row> = {
  key: "name",
  direction: "asc",
  column: templates.name,
  sortValue: row => row.name,
  idColumn: templates.id,
  idOf: row => row.id,
}

const rows: Row[] = [
  { id: "tmpl_01jc5x7m3pfq9a8b2c3d4e5f60", name: "Alpha" },
  { id: "tmpl_01jc5x7m3pfq9a8b2c3d4e5f61", name: "Bravo" },
  { id: "tmpl_01jc5x7m3pfq9a8b2c3d4e5f62", name: "Charlie" },
  { id: "tmpl_01jc5x7m3pfq9a8b2c3d4e5f63", name: "Delta" },
]

describe("toPage", () => {
  test("returns every row and no next cursor when there's no extra row", () => {
    const page = toPage(rows.slice(0, 3), { limit: 3, total: 3, sort: byName, map: row => row.name })

    expect(page).toEqual({ items: ["Alpha", "Bravo", "Charlie"], nextCursor: null, total: 3 })
  })

  test("drops the extra row and returns a next cursor when there is one", () => {
    const page = toPage(rows, { limit: 3, total: 10, sort: byName, map: row => row.name })

    expect(page.items).toEqual(["Alpha", "Bravo", "Charlie"])
    expect(page.nextCursor).not.toBeNull()
  })

  test("points the next cursor at the last returned row, not the extra one", () => {
    const page = toPage(rows, { limit: 3, total: 10, sort: byName, map: row => row.name })

    expect(decodeCursor("name", page.nextCursor!)).toEqual({ value: "Charlie", id: rows[2]!.id })
  })

  test("only maps the rows it returns", () => {
    const map = vi.fn((row: Row) => row.name)
    toPage(rows, { limit: 3, total: 10, sort: byName, map })

    expect(map).toHaveBeenCalledTimes(3)
  })

  test("passes the total through", () => {
    expect(toPage(rows.slice(0, 1), { limit: 3, total: 42, sort: byName, map: row => row }).total).toBe(42)
  })

  test("handles an empty page", () => {
    expect(toPage([], { limit: 3, total: 0, sort: byName, map: row => row })).toEqual({ items: [], nextCursor: null, total: 0 })
  })

  test("uses a null value in the cursor for an ID-only sort", () => {
    const newest: SortDefinition<Row> = { key: "newest", direction: "desc", idColumn: templates.id, idOf: row => row.id }
    const page = toPage(rows, { limit: 2, total: 10, sort: newest, map: row => row })

    expect(decodeCursor("newest", page.nextCursor!)).toEqual({ value: null, id: rows[1]!.id })
  })
})
