import { eq } from "drizzle-orm"
import type request from "supertest"
import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import { schedules, templates, templateVersions } from "@/db/schema.ts"
import { encodeCursor } from "@/util/pagination.ts"
import type { Organization, Template, TemplateVersion } from "@/util/types.ts"
import type { TemplateDetails, TemplateVersionDto } from "@checklog/shared/api"
import {
  addToGroup,
  createGroup,
  createMember,
  createOrganization,
  expectCreationKept,
  grant,
  insertSchedule,
  insertTemplate,
  insertTemplateVersion,
} from "@test/support/database.ts"
import { api, expectError, expectStatus } from "@test/support/http.ts"
import { signedInMember, stubSessions } from "@test/support/session.ts"
import { storedTemplate } from "@test/support/template-drafts.ts"
import { describeTemplateAccess } from "@test/support/template-routes.ts"
import type { TemplateRoute } from "@test/support/template-routes.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates.

stubSessions()

async function insertTemplates(organization: Organization, names: string[], createdBy?: string) {
  const rows: Template[] = []
  for (const name of names) rows.push(await insertTemplate(db, organization, { name, createdBy }))
  return rows
}

async function templatesIn(organizationId: string) {
  return db.select().from(templates).where(eq(templates.organizationId, organizationId))
}

async function scheduleStatusOf(scheduleId: string) {
  const [row] = await db.select({ status: schedules.status }).from(schedules).where(eq(schedules.id, scheduleId))
  return row!.status
}

const templateRoutes: TemplateRoute[] = [
  {
    name: "GET /api/templates/:templateId",
    send: id => api().get(`/api/templates/${id}`),
    needs: "view",
    impersonation: "allow",
    status: "active",
  },
  {
    name: "PATCH /api/templates/:templateId",
    send: id => api().patch(`/api/templates/${id}`).send({ name: "Renamed" }),
    needs: "edit",
    impersonation: "allow",
    status: "active",
  },
  {
    name: "POST /api/templates/:templateId/archive",
    send: id => api().post(`/api/templates/${id}/archive`),
    needs: "edit",
    impersonation: "refuse",
    status: "active",
    conflictStatus: "archived",
  },
  {
    name: "POST /api/templates/:templateId/restore",
    send: id => api().post(`/api/templates/${id}/restore`),
    needs: "edit",
    impersonation: "refuse",
    status: "archived",
    conflictStatus: "active",
  },
]

describeTemplateAccess(templateRoutes)

describe("POST /api/templates", () => {
  function createTemplate(body: unknown) {
    return api().post("/api/templates").send(body as object)
  }

  test("creates the template and responds with it", async () => {
    const { member } = await signedInMember("editor")

    const response = await createTemplate({ name: "Server checks", description: "Weekly" })

    expectStatus(response, 200)
    expect(response.body).toEqual({
      id: expect.stringMatching(/^tmpl_/),
      name: "Server checks",
      description: "Weekly",
      status: "active",
      currentVersionId: null,
      createdAt: expect.any(String),
      createdBy: member.userId,
      updatedAt: expect.any(String),
    })
    expect(new Date(response.body.createdAt).toISOString()).toBe(response.body.createdAt)
  })

  test("stores the template in the member's organization", async () => {
    const { organization } = await signedInMember("editor")

    const response = await createTemplate({ name: "Server checks" })

    const rows = await templatesIn(organization.id)
    expect(rows.map(row => row.id)).toEqual([response.body.id])
    expect(rows[0]!.description).toBeNull()
  })

  test("creates an empty version 1 draft with the template", async () => {
    const { organization, member } = await signedInMember("editor")

    const response = await createTemplate({ name: "Server checks" })

    const versions = await db.select().from(templateVersions).where(eq(templateVersions.templateId, response.body.id))
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      organizationId: organization.id,
      version: 1,
      status: "draft",
      publishedAt: null,
      createdBy: member.userId,
    })
  })

  test("doesn't send the organization ID", async () => {
    await signedInMember("editor")

    const response = await createTemplate({ name: "Server checks" })

    expect(response.body).not.toHaveProperty("organizationId")
  })

  test.each(["owner", "admin", "editor"])("lets an %s create templates", async (role) => {
    await signedInMember(role)

    expectStatus(await createTemplate({ name: "Server checks" }), 200)
  })

  test("refuses a viewer with forbidden and creates nothing", async () => {
    const { organization } = await signedInMember("viewer")

    expectError(await createTemplate({ name: "Server checks" }), 403, "forbidden")
    expect(await templatesIn(organization.id)).toEqual([])
  })

  test("refuses a duplicate active name with validation_failed on the name", async () => {
    const { organization } = await signedInMember("editor")
    await createTemplate({ name: "Server checks" })

    const response = await createTemplate({ name: "Server checks" })

    expectError(response, 400, "validation_failed")
    expect(response.body.error.details).toEqual([{ location: "body", path: ["name"], message: expect.any(String) }])
    expect(await templatesIn(organization.id)).toHaveLength(1)
  })

  test("allows the name of an archived template", async () => {
    const { organization } = await signedInMember("editor")
    await insertTemplate(db, organization, { name: "Server checks", status: "archived" })

    const response = await createTemplate({ name: "Server checks" })

    expectStatus(response, 200)
    expect(await templatesIn(organization.id)).toHaveLength(2)
  })

  test("allows a name used in another organization", async () => {
    const other = await createOrganization(db)
    await insertTemplate(db, other, { name: "Server checks" })
    await signedInMember("editor")

    expectStatus(await createTemplate({ name: "Server checks" }), 200)
  })

  test.each([
    ["a missing name", {}],
    ["an empty name", { name: "" }],
    ["a name over 200 characters", { name: "a".repeat(201) }],
    ["a description over 2000 characters", { name: "Server checks", description: "a".repeat(2001) }],
    ["an unknown field", { name: "Server checks", status: "archived" }],
  ])("refuses %s with validation_failed", async (_description, body) => {
    const { organization } = await signedInMember("editor")

    expectError(await createTemplate(body), 400, "validation_failed")
    expect(await templatesIn(organization.id)).toEqual([])
  })

  test("refuses a signed-out request with unauthorized", async () => {
    expectError(await createTemplate({ name: "Server checks" }), 401, "unauthorized")
  })
})

describe("GET /api/templates", () => {
  function listTemplates(query: Record<string, string | number> = {}) {
    return api().get("/api/templates").query(query)
  }

  function names(response: request.Response): string[] {
    return response.body.items.map((item: { name: string }) => item.name)
  }

  async function pageThrough(query: Record<string, string | number>) {
    const seen: string[] = []
    const totals: number[] = []
    let cursor: string | null = null
    let pageCount = 0
    do {
      const response = await listTemplates(cursor ? { ...query, cursor } : query)
      expectStatus(response, 200)
      seen.push(...names(response))
      totals.push(response.body.total)
      cursor = response.body.nextCursor
      pageCount++
    } while (cursor !== null && pageCount < 10)
    return { seen, totals, pageCount }
  }

  test("lists the organization's templates by name", async () => {
    const { organization } = await signedInMember("admin")
    const [created] = await insertTemplates(organization, ["Server checks", "Backups", "Fire alarm"])

    const response = await listTemplates()

    expectStatus(response, 200)
    expect(names(response)).toEqual(["Backups", "Fire alarm", "Server checks"])
    expect(response.body.total).toBe(3)
    expect(response.body.nextCursor).toBeNull()
    expect(response.body.items[2]).toEqual({
      id: created!.id,
      name: "Server checks",
      description: null,
      status: "active",
      currentVersionId: null,
      createdAt: created!.createdAt.toISOString(),
      createdBy: created!.createdBy,
      updatedAt: created!.updatedAt.toISOString(),
    })
  })

  test("pages through every template once with the cursor", async () => {
    const { organization } = await signedInMember("admin")
    await insertTemplates(organization, ["E", "C", "A", "D", "B"])

    const { seen, totals, pageCount } = await pageThrough({ limit: 2 })

    expect(seen).toEqual(["A", "B", "C", "D", "E"])
    expect(totals).toEqual([5, 5, 5])
    expect(pageCount).toBe(3)
  })

  test("returns no cursor when the last page is exactly full", async () => {
    const { organization } = await signedInMember("admin")
    await insertTemplates(organization, ["A", "B"])

    const response = await listTemplates({ limit: 2 })

    expect(names(response)).toEqual(["A", "B"])
    expect(response.body.nextCursor).toBeNull()
  })

  test("leaves out other organizations' templates", async () => {
    const other = await createOrganization(db)
    await insertTemplates(other, ["Elsewhere"])
    const { organization } = await signedInMember("owner")
    await insertTemplates(organization, ["Mine"])

    const response = await listTemplates()

    expect(names(response)).toEqual(["Mine"])
    expect(response.body.total).toBe(1)
  })

  test.each(["editor", "viewer"])("shows a member with the %s role only the templates they created or were granted", async (role) => {
    const { organization, member } = await signedInMember(role)
    const teamId = await createGroup(db, organization)
    await addToGroup(db, teamId, member)
    const [, memberGrant, groupGrant] = await insertTemplates(organization, ["Hidden", "Granted to member", "Granted to group"])
    await insertTemplates(organization, ["Created by them"], member.userId)
    await grant(db, memberGrant!.id, { organization, memberId: member.id }, "view")
    await grant(db, groupGrant!.id, { organization, teamId }, "run")

    const response = await listTemplates()

    expect(names(response)).toEqual(["Created by them", "Granted to group", "Granted to member"])
    expect(response.body.total).toBe(3)
  })

  test("doesn't count a grant to someone else", async () => {
    const { organization } = await signedInMember("viewer")
    const { member: someoneElse } = await createMember(db, organization, "viewer")
    const [template] = await insertTemplates(organization, ["Theirs"])
    await grant(db, template!.id, { organization, memberId: someoneElse.id }, "edit")

    const response = await listTemplates()

    expect(response.body).toEqual({ items: [], total: 0, nextCursor: null })
  })

  test.each([
    ["a cursor that isn't base64url JSON", "not-a-cursor"],
    ["a cursor for a different sort", encodeCursor("oldest", null, "tmpl_x")],
  ])("refuses %s with bad_request", async (_description, cursor) => {
    await signedInMember("admin")

    expectError(await listTemplates({ cursor }), 400, "bad_request")
  })

  test.each([
    ["a limit of 0", 0],
    ["a limit over 100", 101],
    ["a limit that isn't a whole number", 1.5],
  ])("refuses %s with validation_failed", async (_description, limit) => {
    await signedInMember("admin")

    expectError(await listTemplates({ limit }), 400, "validation_failed")
  })

  test("refuses a signed-out request with unauthorized", async () => {
    expectError(await listTemplates(), 401, "unauthorized")
  })

  describe("status filter", () => {
    async function activeAndArchived(organization: Organization) {
      await insertTemplates(organization, ["Server checks", "Backups"])
      await insertTemplate(db, organization, { name: "Fire alarm", status: "archived" })
    }

    test("lists only active templates by default", async () => {
      const { organization } = await signedInMember("admin")
      await activeAndArchived(organization)

      const response = await listTemplates()

      expect(names(response)).toEqual(["Backups", "Server checks"])
      expect(response.body.total).toBe(2)
    })

    test("lists only active templates with status=active", async () => {
      const { organization } = await signedInMember("admin")
      await activeAndArchived(organization)

      const response = await listTemplates({ status: "active" })

      expect(names(response)).toEqual(["Backups", "Server checks"])
      expect(response.body.total).toBe(2)
    })

    test("lists only archived templates with status=archived", async () => {
      const { organization } = await signedInMember("admin")
      await activeAndArchived(organization)

      const response = await listTemplates({ status: "archived" })

      expectStatus(response, 200)
      expect(names(response)).toEqual(["Fire alarm"])
      expect(response.body.items[0].status).toBe("archived")
      expect(response.body.total).toBe(1)
    })

    test("pages through archived templates with the cursor", async () => {
      const { organization } = await signedInMember("admin")
      for (const name of ["E", "C", "A", "D", "B"]) await insertTemplate(db, organization, { name, status: "archived" })
      await insertTemplates(organization, ["Active"])

      const { seen, totals } = await pageThrough({ status: "archived", limit: 2 })

      expect(seen).toEqual(["A", "B", "C", "D", "E"])
      expect(totals).toEqual([5, 5, 5])
    })

    test("still applies the member's access to archived templates", async () => {
      const { organization, member } = await signedInMember("viewer")
      await insertTemplate(db, organization, { name: "Mine", status: "archived", createdBy: member.userId })
      await insertTemplate(db, organization, { name: "Hidden", status: "archived" })

      const response = await listTemplates({ status: "archived" })

      expect(names(response)).toEqual(["Mine"])
      expect(response.body.total).toBe(1)
    })

    test("refuses an unknown status with validation_failed", async () => {
      await signedInMember("admin")

      expectError(await listTemplates({ status: "deleted" }), 400, "validation_failed")
    })
  })
})

describe("GET /api/templates/:templateId", () => {
  function getTemplate(templateId: string) {
    return api().get(`/api/templates/${templateId}`)
  }

  async function makeCurrent(template: Template, version: TemplateVersion) {
    const [row] = await db.update(templates).set({ currentVersionId: version.id }).where(eq(templates.id, template.id)).returning()
    return row!
  }

  function versionDto(row: TemplateVersion): TemplateVersionDto {
    return {
      id: row.id,
      templateId: row.templateId,
      version: row.version,
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      publishedBy: row.publishedBy,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  test("responds with the template, its current version and its draft", async () => {
    const { organization } = await signedInMember("admin")
    const inserted = await insertTemplate(db, organization, { name: "Server checks" })
    const published = await insertTemplateVersion(db, inserted, 1, "published")
    const draft = await insertTemplateVersion(db, inserted, 2, "draft")
    const template = await makeCurrent(inserted, published)

    const response = await getTemplate(template.id)

    expectStatus(response, 200)
    expect(response.body).toEqual({
      id: template.id,
      name: "Server checks",
      description: null,
      status: "active",
      currentVersionId: published.id,
      createdAt: template.createdAt.toISOString(),
      createdBy: template.createdBy,
      updatedAt: template.updatedAt.toISOString(),
      currentVersion: versionDto(published),
      draftVersion: versionDto(draft),
    } satisfies TemplateDetails)
  })

  test("responds with a new template's version 1 draft and no current version", async () => {
    await signedInMember("editor")
    const created = await api().post("/api/templates").send({ name: "Server checks" })

    const response = await getTemplate(created.body.id)

    expectStatus(response, 200)
    expect(response.body.currentVersion).toBeNull()
    expect(response.body.draftVersion).toMatchObject({ templateId: created.body.id, version: 1, status: "draft", publishedAt: null })
  })

  test("responds with no draft when the template has none", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization)
    const published = await insertTemplateVersion(db, template, 1, "published")
    await makeCurrent(template, published)

    const response = await getTemplate(template.id)

    expect(response.body.currentVersion).toEqual(versionDto(published))
    expect(response.body.draftVersion).toBeNull()
  })

  test("doesn't treat older published or archived versions as the draft", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization)
    await insertTemplateVersion(db, template, 1, "archived")
    await insertTemplateVersion(db, template, 2, "published")
    const current = await insertTemplateVersion(db, template, 3, "published")
    await makeCurrent(template, current)

    const response = await getTemplate(template.id)

    expect(response.body.currentVersion.id).toBe(current.id)
    expect(response.body.draftVersion).toBeNull()
  })

  test("responds with an archived current version", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization)
    const archived = await insertTemplateVersion(db, template, 1, "archived")
    await makeCurrent(template, archived)

    const response = await getTemplate(template.id)

    expect(response.body.currentVersion).toEqual(versionDto(archived))
  })

  test("responds with another template's versions only for that template", async () => {
    const { organization } = await signedInMember("admin")
    const first = await insertTemplate(db, organization)
    const second = await insertTemplate(db, organization)
    const firstDraft = await insertTemplateVersion(db, first, 1, "draft")
    await insertTemplateVersion(db, second, 1, "draft")

    const response = await getTemplate(first.id)

    expect(response.body.draftVersion.id).toBe(firstDraft.id)
  })

  test("responds with an archived template and its versions", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization, { status: "archived" })
    const published = await insertTemplateVersion(db, template, 1, "published")
    const draft = await insertTemplateVersion(db, template, 2, "draft")
    await makeCurrent(template, published)

    const response = await getTemplate(template.id)

    expectStatus(response, 200)
    expect(response.body.status).toBe("archived")
    expect(response.body.currentVersion.id).toBe(published.id)
    expect(response.body.draftVersion.id).toBe(draft.id)
  })

  test("doesn't send organization IDs", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization)
    const published = await insertTemplateVersion(db, template, 1, "published")
    await insertTemplateVersion(db, template, 2, "draft")
    await makeCurrent(template, published)

    const response = await getTemplate(template.id)

    expect(response.body).not.toHaveProperty("organizationId")
    expect(response.body.currentVersion).not.toHaveProperty("organizationId")
    expect(response.body.draftVersion).not.toHaveProperty("organizationId")
  })

  test.each(["view", "run", "edit"] as const)("responds with the versions to a member with %s access", async (level) => {
    const { organization, member } = await signedInMember("viewer")
    const template = await insertTemplate(db, organization)
    const draft = await insertTemplateVersion(db, template, 1, "draft")
    await grant(db, template.id, { organization, memberId: member.id }, level)

    const response = await getTemplate(template.id)

    expect(response.body.id).toBe(template.id)
    expect(response.body.draftVersion.id).toBe(draft.id)
  })

  test("responds with the versions to a member whose group has access", async () => {
    const { organization, member } = await signedInMember("viewer")
    const teamId = await createGroup(db, organization)
    await addToGroup(db, teamId, member)
    const template = await insertTemplate(db, organization)
    const draft = await insertTemplateVersion(db, template, 1, "draft")
    await grant(db, template.id, { organization, teamId }, "view")

    const response = await getTemplate(template.id)

    expect(response.body.draftVersion.id).toBe(draft.id)
  })

  test("refuses a template the member can't see with not_found, even when it has versions", async () => {
    const { organization } = await signedInMember("viewer")
    const template = await insertTemplate(db, organization)
    const published = await insertTemplateVersion(db, template, 1, "published")
    await insertTemplateVersion(db, template, 2, "draft")
    await makeCurrent(template, published)

    expectError(await getTemplate(template.id), 404, "not_found")
  })
})

describe("PATCH /api/templates/:templateId", () => {
  function updateTemplate(templateId: string, body: unknown) {
    return api().patch(`/api/templates/${templateId}`).send(body as object)
  }

  async function templateWithDescription(organization: Organization) {
    return insertTemplate(db, organization, { name: "Server checks", description: "Weekly" })
  }

  test("keeps who created the template, and when", async () => {
    const { organization } = await signedInMember("admin")
    const template = await templateWithDescription(organization)

    expectStatus(await updateTemplate(template.id, { name: "Database checks" }), 200)

    expectCreationKept(template, await storedTemplate(template.id))
  })

  test("renames the template and responds with it", async () => {
    const { organization } = await signedInMember("admin")
    const template = await templateWithDescription(organization)

    const response = await updateTemplate(template.id, { name: "Database checks" })

    expectStatus(response, 200)
    expect(response.body).toEqual({
      id: template.id,
      name: "Database checks",
      description: "Weekly",
      status: "active",
      currentVersionId: null,
      createdAt: template.createdAt.toISOString(),
      createdBy: template.createdBy,
      updatedAt: expect.any(String),
    })
    expect(new Date(response.body.updatedAt).getTime()).toBeGreaterThan(template.updatedAt.getTime())
    expect(await storedTemplate(template.id)).toMatchObject({ name: "Database checks", description: "Weekly" })
  })

  test("changes only the description when only the description is sent", async () => {
    const { organization } = await signedInMember("admin")
    const template = await templateWithDescription(organization)

    const response = await updateTemplate(template.id, { description: "Daily" })

    expectStatus(response, 200)
    expect(await storedTemplate(template.id)).toMatchObject({ name: "Server checks", description: "Daily" })
  })

  test("clears the description when it's null", async () => {
    const { organization } = await signedInMember("admin")
    const template = await templateWithDescription(organization)

    const response = await updateTemplate(template.id, { description: null })

    expectStatus(response, 200)
    expect(response.body.description).toBeNull()
    expect(await storedTemplate(template.id)).toMatchObject({ name: "Server checks", description: null })
  })

  test("changes the name and description together", async () => {
    const { organization } = await signedInMember("admin")
    const template = await templateWithDescription(organization)

    await updateTemplate(template.id, { name: "Database checks", description: "Daily" })

    expect(await storedTemplate(template.id)).toMatchObject({ name: "Database checks", description: "Daily" })
  })

  test("allows sending the template's current name", async () => {
    const { organization } = await signedInMember("admin")
    const template = await templateWithDescription(organization)

    expectStatus(await updateTemplate(template.id, { name: "Server checks" }), 200)
  })

  test("leaves other templates alone", async () => {
    const { organization } = await signedInMember("admin")
    const [template, other] = await insertTemplates(organization, ["Server checks", "Backups"])

    await updateTemplate(template!.id, { name: "Database checks" })

    expect((await storedTemplate(other!.id)).name).toBe("Backups")
  })

  test("refuses another active template's name with validation_failed on the name", async () => {
    const { organization } = await signedInMember("admin")
    const [template] = await insertTemplates(organization, ["Server checks", "Backups"])

    const response = await updateTemplate(template!.id, { name: "Backups" })

    expectError(response, 400, "validation_failed")
    expect(response.body.error.details).toEqual([{ location: "body", path: ["name"], message: expect.any(String) }])
    expect((await storedTemplate(template!.id)).name).toBe("Server checks")
  })

  test("allows the name of an archived template", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization, { name: "Server checks" })
    await insertTemplate(db, organization, { name: "Backups", status: "archived" })

    expectStatus(await updateTemplate(template.id, { name: "Backups" }), 200)
  })

  test.each([
    ["an empty body", {}],
    ["an empty name", { name: "" }],
    ["a null name", { name: null }],
    ["a name over 200 characters", { name: "a".repeat(201) }],
    ["a description over 2000 characters", { description: "a".repeat(2001) }],
    ["an unknown field", { status: "archived" }],
  ])("refuses %s with validation_failed and changes nothing", async (_description, body) => {
    const { organization } = await signedInMember("admin")
    const template = await templateWithDescription(organization)

    expectError(await updateTemplate(template.id, body), 400, "validation_failed")
    expect(await storedTemplate(template.id)).toEqual(template)
  })
})

describe("POST /api/templates/:templateId/archive", () => {
  function archiveTemplate(templateId: string) {
    return api().post(`/api/templates/${templateId}/archive`)
  }

  test("keeps who created the template and its schedules, and when", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization)
    const schedule = await insertSchedule(db, template, "active")

    expectStatus(await archiveTemplate(template.id), 200)

    expectCreationKept(template, await storedTemplate(template.id))
    const [storedSchedule] = await db.select().from(schedules).where(eq(schedules.id, schedule.id))
    expectCreationKept(schedule, storedSchedule)
  })

  test("archives the template and responds with it", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization, { name: "Server checks" })

    const response = await archiveTemplate(template.id)

    expectStatus(response, 200)
    expect(response.body).toEqual({
      id: template.id,
      name: "Server checks",
      description: null,
      status: "archived",
      currentVersionId: null,
      createdAt: template.createdAt.toISOString(),
      createdBy: template.createdBy,
      updatedAt: expect.any(String),
    })
    expect((await storedTemplate(template.id)).status).toBe("archived")
  })

  test("archives the template's active and paused schedules", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization)
    const active = await insertSchedule(db, template, "active")
    const paused = await insertSchedule(db, template, "paused")

    await archiveTemplate(template.id)

    expect(await scheduleStatusOf(active.id)).toBe("archived")
    expect(await scheduleStatusOf(paused.id)).toBe("archived")
  })

  test("leaves already archived schedules unchanged", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization)
    const archived = await insertSchedule(db, template, "archived")

    await archiveTemplate(template.id)

    const [row] = await db.select().from(schedules).where(eq(schedules.id, archived.id))
    expect(row).toEqual(archived)
  })

  test("leaves other templates and their schedules alone", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization)
    const other = await insertTemplate(db, organization)
    const otherSchedule = await insertSchedule(db, other, "active")

    await archiveTemplate(template.id)

    expect((await storedTemplate(other.id)).status).toBe("active")
    expect(await scheduleStatusOf(otherSchedule.id)).toBe("active")
  })

  test("leaves the schedules alone when the request is refused", async () => {
    const { organization, member } = await signedInMember("viewer")
    const template = await insertTemplate(db, organization)
    const schedule = await insertSchedule(db, template, "active")
    await grant(db, template.id, { organization, memberId: member.id }, "run")

    expectError(await archiveTemplate(template.id), 403, "forbidden")
    expect(await scheduleStatusOf(schedule.id)).toBe("active")
  })

  test("leaves another organization's schedules alone", async () => {
    const other = await createOrganization(db)
    const template = await insertTemplate(db, other)
    const schedule = await insertSchedule(db, template, "active")
    await signedInMember("owner")

    expectError(await archiveTemplate(template.id), 404, "not_found")
    expect(await scheduleStatusOf(schedule.id)).toBe("active")
  })
})

describe("POST /api/templates/:templateId/restore", () => {
  function restoreTemplate(templateId: string) {
    return api().post(`/api/templates/${templateId}/restore`)
  }

  test("keeps who created the template, and when", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization, { status: "archived" })

    expectStatus(await restoreTemplate(template.id), 200)

    expectCreationKept(template, await storedTemplate(template.id))
  })

  test("restores the template and responds with it", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization, { name: "Server checks", status: "archived" })

    const response = await restoreTemplate(template.id)

    expectStatus(response, 200)
    expect(response.body).toEqual({
      id: template.id,
      name: "Server checks",
      description: null,
      status: "active",
      currentVersionId: null,
      createdAt: template.createdAt.toISOString(),
      createdBy: template.createdBy,
      updatedAt: expect.any(String),
    })
    expect((await storedTemplate(template.id)).status).toBe("active")
  })

  test("leaves the template's schedules archived", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization, { status: "archived" })
    const schedule = await insertSchedule(db, template, "archived")

    await restoreTemplate(template.id)

    expect(await scheduleStatusOf(schedule.id)).toBe("archived")
  })

  test("refuses a name another active template now uses with conflict and changes nothing", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization, { name: "Server checks", status: "archived" })
    await insertTemplate(db, organization, { name: "Server checks" })

    expectError(await restoreTemplate(template.id), 409, "conflict")
    expect((await storedTemplate(template.id)).status).toBe("archived")
  })

  test("allows a name only another archived template uses", async () => {
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization, { name: "Server checks", status: "archived" })
    await insertTemplate(db, organization, { name: "Server checks", status: "archived" })

    expectStatus(await restoreTemplate(template.id), 200)
  })

  test("allows a name an active template uses in another organization", async () => {
    const other = await createOrganization(db)
    await insertTemplate(db, other, { name: "Server checks" })
    const { organization } = await signedInMember("admin")
    const template = await insertTemplate(db, organization, { name: "Server checks", status: "archived" })

    expectStatus(await restoreTemplate(template.id), 200)
  })
})
