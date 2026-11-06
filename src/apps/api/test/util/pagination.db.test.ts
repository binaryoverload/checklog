import { and, asc, count, desc, eq, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import { describe, expect, test } from "vitest"

import { templates } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import { cursorCondition, orderFor, toPage } from "@/util/pagination.ts"
import type { SortDefinition } from "@/util/pagination.ts"
import type { Database, Organization } from "@/util/types.ts"
import type { Paginated } from "@checklog/shared/api"
import { createOrganization, inRollback } from "@test/support/database.ts"

type TemplateRow = typeof templates.$inferSelect

// Each sort, with the ORDER BY it should match, written out independently of orderFor
const sorts: { sort: SortDefinition<TemplateRow>, expectedOrder: SQL[] }[] = [
  {
    sort: { key: "newest", direction: "desc", idColumn: templates.id, idOf: row => row.id },
    expectedOrder: [desc(templates.id)],
  },
  {
    sort: { key: "name", direction: "asc", column: templates.name, sortValue: row => row.name, idColumn: templates.id, idOf: row => row.id },
    expectedOrder: [asc(templates.name), asc(templates.id)],
  },
  {
    sort: { key: "created", direction: "desc", column: templates.createdAt, sortValue: row => row.createdAt, idColumn: templates.id, idOf: row => row.id },
    expectedOrder: [desc(templates.createdAt), desc(templates.id)],
  },
  {
    // A nullable column has to be sorted through coalesce, or rows with NULL drop out after the first page
    sort: {
      key: "description",
      direction: "asc",
      column: sql`coalesce(${templates.description}, '')`,
      sortValue: row => row.description ?? "",
      idColumn: templates.id,
      idOf: row => row.id,
    },
    expectedOrder: [asc(sql`coalesce(${templates.description}, '')`), asc(templates.id)],
  },
]

const newest = sorts[0]!.sort
const byName = sorts[1]!.sort

// Three timestamps and three descriptions (one of them NULL) shared across rows, so every sort has ties to break
const timestamps = [new Date("2026-11-01T09:00:00Z"), new Date("2026-11-02T09:00:00Z"), new Date("2026-11-03T09:00:00Z")]
const descriptions = [null, "Monthly", "Weekly"]

let nameCount = 0

async function insertTemplates(tx: Database, organization: Organization, howMany: number): Promise<void> {
  const values = Array.from({ length: howMany }, (_, index) => ({
    organizationId: organization.id,
    name: `Paged template ${String(++nameCount).padStart(4, "0")}`,
    description: descriptions[index % descriptions.length],
    createdAt: timestamps[index % timestamps.length],
    createdBy: "user_test",
  }))
  await tx.insert(templates).values(values)
}

// Wires the helpers together the way a list route does
async function listTemplates(
  tx: Database,
  organization: Organization,
  sort: SortDefinition<TemplateRow>,
  query: { limit: number, cursor?: string },
): Promise<Paginated<string>> {
  const inOrganization = eq(templates.organizationId, organization.id)

  const [rows, [counted]] = await Promise.all([
    tx.select()
      .from(templates)
      .where(and(inOrganization, cursorCondition(sort, query.cursor)))
      .orderBy(...orderFor(sort))
      .limit(query.limit + 1),
    tx.select({ total: count() }).from(templates).where(inOrganization),
  ])

  return toPage(rows, { limit: query.limit, total: counted!.total, sort, map: row => row.id })
}

async function listAll(
  tx: Database,
  organization: Organization,
  sort: SortDefinition<TemplateRow>,
  limit: number,
): Promise<{ ids: string[], pages: Paginated<string>[] }> {
  const pages: Paginated<string>[] = []
  let cursor: string | undefined

  // A cursor that never ends would loop forever, so stop well past the expected number of pages
  for (let pageCount = 0; pageCount < 50; pageCount++) {
    const page = await listTemplates(tx, organization, sort, { limit, cursor })
    pages.push(page)
    if (page.nextCursor === null) break
    cursor = page.nextCursor
  }

  return { ids: pages.flatMap(page => page.items), pages }
}

async function orderedIds(tx: Database, organization: Organization, order: SQL[]): Promise<string[]> {
  const rows = await tx.select({ id: templates.id }).from(templates).where(eq(templates.organizationId, organization.id)).orderBy(...order)
  return rows.map(row => row.id)
}

describe.each(sorts)("paging by $sort.key", ({ sort, expectedOrder }) => {
  test("returns every row exactly once, in order", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    await insertTemplates(tx, organization, 30)

    const { ids, pages } = await listAll(tx, organization, sort, 7)

    expect(pages.map(page => page.items.length)).toEqual([7, 7, 7, 7, 2])
    expect(new Set(ids).size).toBe(30)
    expect(ids).toEqual(await orderedIds(tx, organization, expectedOrder))
  }))

  test("orders the first page like the full list", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    await insertTemplates(tx, organization, 10)

    const page = await listTemplates(tx, organization, sort, { limit: 4 })

    expect(page.items).toEqual((await orderedIds(tx, organization, expectedOrder)).slice(0, 4))
  }))
})

describe("paging", () => {
  test("ends without an empty page when the rows divide evenly", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    await insertTemplates(tx, organization, 30)

    const { pages } = await listAll(tx, organization, newest, 10)

    expect(pages.map(page => page.items.length)).toEqual([10, 10, 10])
    expect(pages.at(-1)!.nextCursor).toBeNull()
  }))

  test("returns a single page with no next cursor when everything fits", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    await insertTemplates(tx, organization, 5)

    const page = await listTemplates(tx, organization, newest, { limit: 25 })

    expect(page.items).toHaveLength(5)
    expect(page.nextCursor).toBeNull()
  }))

  test("returns an empty page for an empty list", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)

    expect(await listTemplates(tx, organization, newest, { limit: 25 })).toEqual({ items: [], nextCursor: null, total: 0 })
  }))

  test("reports the same total on every page", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    await insertTemplates(tx, organization, 30)

    const { pages } = await listAll(tx, organization, byName, 7)

    expect(pages.map(page => page.total)).toEqual([30, 30, 30, 30, 30])
  }))

  test("keeps other organizations' rows out of the items and the total", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const otherOrganization = await createOrganization(tx, "Other organization")
    await insertTemplates(tx, organization, 8)
    await insertTemplates(tx, otherOrganization, 12)

    const { ids, pages } = await listAll(tx, organization, newest, 5)

    expect(ids.sort()).toEqual((await orderedIds(tx, organization, [asc(templates.id)])).sort())
    expect(pages[0]!.total).toBe(8)
  }))

  test("doesn't repeat or skip rows when a newer row is added between pages", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    await insertTemplates(tx, organization, 20)
    const before = await orderedIds(tx, organization, [desc(templates.id)])

    const first = await listTemplates(tx, organization, newest, { limit: 7 })
    await insertTemplates(tx, organization, 1)
    const { ids: rest } = await listAllFrom(tx, organization, newest, 7, first.nextCursor!)

    expect([...first.items, ...rest]).toEqual(before)
  }))

  test("carries on from a cursor whose row has since been deleted", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    await insertTemplates(tx, organization, 20)
    const before = await orderedIds(tx, organization, [asc(templates.name), asc(templates.id)])

    const first = await listTemplates(tx, organization, byName, { limit: 7 })
    await tx.delete(templates).where(eq(templates.id, first.items.at(-1)!))
    const { ids: rest } = await listAllFrom(tx, organization, byName, 7, first.nextCursor!)

    expect(rest).toEqual(before.slice(7))
  }))

  test("rejects a cursor from a different sort", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    await insertTemplates(tx, organization, 10)

    const first = await listTemplates(tx, organization, byName, { limit: 3 })

    await expect(listTemplates(tx, organization, newest, { limit: 3, cursor: first.nextCursor! }))
      .rejects.toSatisfy(error => error instanceof HttpError && error.code === "bad_request")
  }))
})

async function listAllFrom(
  tx: Database,
  organization: Organization,
  sort: SortDefinition<TemplateRow>,
  limit: number,
  cursor: string,
): Promise<{ ids: string[] }> {
  const ids: string[] = []
  let next: string | null = cursor

  for (let pageCount = 0; next !== null && pageCount < 50; pageCount++) {
    const page: Paginated<string> = await listTemplates(tx, organization, sort, { limit, cursor: next })
    ids.push(...page.items)
    next = page.nextCursor
  }

  return { ids }
}
