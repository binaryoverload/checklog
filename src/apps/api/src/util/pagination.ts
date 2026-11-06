import { asc, desc, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import z from "zod"

import { HttpError } from "@/http/errors.ts"
import type { Paginated } from "@checklog/shared/api"
import { safeJsonParse } from "@checklog/shared/utils"

export type SortValue = string | number | Date

// How a list is ordered. Without a column, the list is ordered by ID alone and the cursor's value is null.
// The sort column must not be nullable; wrap a nullable one in coalesce in both column and sortValue.
export interface SortDefinition<TRow> {
  key: string
  direction: "asc" | "desc"
  idColumn: AnyPgColumn
  idOf: (row: TRow) => string
  column?: AnyPgColumn | SQL
  sortValue?: (row: TRow) => SortValue
}

const cursorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("date"),
    value: z.iso.datetime().transform(d => new Date(d)).nullable(),
  }),
  z.object({
    type: z.literal("string"),
    value: z.string().nullable(),
  }),
  z.object({
    type: z.literal("number"),
    value: z.number().nullable(),
  }),
]).and(z.object({
  id: z.string(),
  sortKey: z.string(),
}))

export function encodeCursor(sortKey: string, value: SortValue | null, id: string): string {
  const type = value instanceof Date ? "date" : typeof value === "string" ? "string" : "number"

  const payload = JSON.stringify({ type, value, sortKey, id })
  return Buffer.from(payload).toString("base64url")
}

export function decodeCursor(sortKey: string, cursor: string): { value: SortValue | null, id: string } {
  if (cursor.trim().length === 0) throw new HttpError("bad_request", "Cursor is empty")
  const decoded = safeJsonParse(Buffer.from(cursor, "base64url").toString("utf-8"))
  if (!decoded) throw new HttpError("bad_request", "Invalid JSON")
  const parsed = cursorSchema.safeParse(decoded)
  if (!parsed.success || parsed.data.sortKey !== sortKey) throw new HttpError("bad_request", "Invalid cursor")
  return { value: parsed.data.value, id: parsed.data.id }
}

export function cursorCondition<TRow>(sort: SortDefinition<TRow>, cursor: string | undefined): SQL | undefined {
  if (!cursor) return undefined

  const { value, id } = decodeCursor(sort.key, cursor)

  if (!sort.column) return sql`${sort.idColumn} ${sql.raw(sort.direction === "asc" ? ">" : "<")} ${id}`
  return sql`(${sort.column}, ${sort.idColumn}) ${sql.raw(sort.direction === "asc" ? ">" : "<")} (${value}, ${id})`
}

export function orderFor<TRow>(sort: SortDefinition<TRow>): SQL[] {
  if (!sort.column) return sort.direction === "asc" ? [asc(sort.idColumn)] : [desc(sort.idColumn)]

  return [
    sort.direction === "asc" ? asc(sort.column) : desc(sort.column),
    sort.direction === "asc" ? asc(sort.idColumn) : desc(sort.idColumn),
  ]
}

export function toPage<TRow, TItem>(
  rows: TRow[],
  options: { limit: number, total: number, sort: SortDefinition<TRow>, map: (row: TRow) => TItem },
): Paginated<TItem> {
  const { limit, total, sort, map } = options
  const items = rows.slice(0, limit).map(map)

  let nextCursor: string | null = null
  if (rows.length > limit) {
    const lastRow = rows[limit - 1]!
    nextCursor = encodeCursor(sort.key, sort.sortValue?.(lastRow) ?? null, sort.idOf(lastRow))
  }

  return {
    items,
    total,
    nextCursor,
  }
}
