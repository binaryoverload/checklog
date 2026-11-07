import { eq } from "drizzle-orm"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { createApp } from "@/app.ts"
import { auth } from "@/core/auth.ts"
import { db } from "@/db/index.ts"
import { templates, templateVersions } from "@/db/schema.ts"
import { encodeCursor } from "@/util/pagination.ts"
import type { Organization, PermissionContext } from "@/util/types.ts"
import { typeIdForTable } from "@checklog/shared/utils"
import { addToGroup, createGroup, createMember, createOrganization, grant } from "@test/support/database.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates.

let getSession: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  getSession = vi.spyOn(auth.api, "getSession").mockResolvedValue(null as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Stubs only the session lookup; the membership is loaded from the database as in production
function signInAs({ organization, member }: PermissionContext) {
  getSession.mockResolvedValue({
    user: { id: member.userId, email: `${member.userId}@example.com`, name: "Test user" },
    session: { id: "sess_test", userId: member.userId, activeOrganizationId: organization.id },
  } as never)
}

async function signedInMember(role: string) {
  const organization = await createOrganization(db)
  const context = await createMember(db, organization, role)
  signInAs(context)
  return context
}

function createTemplate(body: unknown) {
  return request(createApp()).post("/api/templates").send(body as object)
}

async function templatesIn(organizationId: string) {
  return db.select().from(templates).where(eq(templates.organizationId, organizationId))
}

function listTemplates(query: Record<string, string | number> = {}) {
  return request(createApp()).get("/api/templates").query(query)
}

async function insertTemplates(organization: Organization, names: string[], createdBy = "user_someone_else") {
  const rows = await db.insert(templates)
    .values(names.map(name => ({ organizationId: organization.id, name, createdBy })))
    .returning()
  return rows
}

function names(response: request.Response): string[] {
  return response.body.items.map((item: { name: string }) => item.name)
}

describe("POST /api/templates", () => {
  test("creates the template and responds with it", async () => {
    const { member } = await signedInMember("editor")

    const response = await createTemplate({ name: "Server checks", description: "Weekly" })

    expect(response.status).toBe(200)
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

    expect((await createTemplate({ name: "Server checks" })).status).toBe(200)
  })

  test("refuses a viewer with forbidden and creates nothing", async () => {
    const { organization } = await signedInMember("viewer")

    const response = await createTemplate({ name: "Server checks" })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("forbidden")
    expect(await templatesIn(organization.id)).toEqual([])
  })

  test("refuses a duplicate active name with validation_failed on the name", async () => {
    const { organization } = await signedInMember("editor")
    await createTemplate({ name: "Server checks" })

    const response = await createTemplate({ name: "Server checks" })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("validation_failed")
    expect(response.body.error.details).toEqual([{ location: "body", path: ["name"], message: expect.any(String) }])
    expect(await templatesIn(organization.id)).toHaveLength(1)
  })

  test("allows the name of an archived template", async () => {
    const { organization } = await signedInMember("editor")
    const first = await createTemplate({ name: "Server checks" })
    await db.update(templates).set({ status: "archived" }).where(eq(templates.id, first.body.id))

    const response = await createTemplate({ name: "Server checks" })

    expect(response.status).toBe(200)
    expect(await templatesIn(organization.id)).toHaveLength(2)
  })

  test("allows a name used in another organization", async () => {
    await signedInMember("editor")
    await createTemplate({ name: "Server checks" })
    await signedInMember("editor")

    expect((await createTemplate({ name: "Server checks" })).status).toBe(200)
  })

  test.each([
    ["a missing name", {}],
    ["an empty name", { name: "" }],
    ["a name over 200 characters", { name: "a".repeat(201) }],
    ["a description over 2000 characters", { name: "Server checks", description: "a".repeat(2001) }],
    ["an unknown field", { name: "Server checks", status: "archived" }],
  ])("refuses %s with validation_failed", async (_description, body) => {
    const { organization } = await signedInMember("editor")

    const response = await createTemplate(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("validation_failed")
    expect(await templatesIn(organization.id)).toEqual([])
  })

  test("refuses a signed-out request with unauthorized", async () => {
    const response = await createTemplate({ name: "Server checks" })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe("unauthorized")
  })
})

describe("GET /api/templates", () => {
  test("lists the organization's templates by name", async () => {
    const { organization } = await signedInMember("admin")
    const [created] = await insertTemplates(organization, ["Server checks", "Backups", "Fire alarm"])

    const response = await listTemplates()

    expect(response.status).toBe(200)
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

    const seen: string[] = []
    let cursor: string | null = null
    let pageCount = 0
    do {
      const response = await listTemplates(cursor ? { limit: 2, cursor } : { limit: 2 })
      expect(response.status).toBe(200)
      expect(response.body.total).toBe(5)
      seen.push(...names(response))
      cursor = response.body.nextCursor
      pageCount++
    } while (cursor !== null && pageCount < 10)

    expect(seen).toEqual(["A", "B", "C", "D", "E"])
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

  test.each(["editor", "viewer"])("shows an %s only the templates they created or were granted", async (role) => {
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

    const response = await listTemplates({ cursor })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("bad_request")
  })

  test.each([
    ["a limit of 0", 0],
    ["a limit over 100", 101],
    ["a limit that isn't a whole number", 1.5],
  ])("refuses %s with validation_failed", async (_description, limit) => {
    await signedInMember("admin")

    const response = await listTemplates({ limit })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("validation_failed")
  })

  test("refuses a signed-out request with unauthorized", async () => {
    const response = await listTemplates()

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe("unauthorized")
  })
})

describe("GET /api/templates/:templateId", () => {
  function getTemplate(templateId: string) {
    return request(createApp()).get(`/api/templates/${templateId}`)
  }

  test("responds with the template", async () => {
    const { organization } = await signedInMember("admin")
    const [template] = await insertTemplates(organization, ["Server checks"])

    const response = await getTemplate(template!.id)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      id: template!.id,
      name: "Server checks",
      description: null,
      status: "active",
      currentVersionId: null,
      createdAt: template!.createdAt.toISOString(),
      createdBy: template!.createdBy,
      updatedAt: template!.updatedAt.toISOString(),
    })
  })

  test("responds with an archived template", async () => {
    const { organization } = await signedInMember("admin")
    const [template] = await insertTemplates(organization, ["Server checks"])
    await db.update(templates).set({ status: "archived" }).where(eq(templates.id, template!.id))

    const response = await getTemplate(template!.id)

    expect(response.status).toBe(200)
    expect(response.body.status).toBe("archived")
  })

  test.each(["editor", "viewer"])("lets an %s get a template they created", async (role) => {
    const { organization, member } = await signedInMember(role)
    const [template] = await insertTemplates(organization, ["Server checks"], member.userId)

    expect((await getTemplate(template!.id)).status).toBe(200)
  })

  test.each(["view", "run", "edit"] as const)("lets a viewer with %s access get the template", async (level) => {
    const { organization, member } = await signedInMember("viewer")
    const [template] = await insertTemplates(organization, ["Server checks"])
    await grant(db, template!.id, { organization, memberId: member.id }, level)

    expect((await getTemplate(template!.id)).status).toBe(200)
  })

  test("lets a viewer get a template granted to their group", async () => {
    const { organization, member } = await signedInMember("viewer")
    const teamId = await createGroup(db, organization)
    await addToGroup(db, teamId, member)
    const [template] = await insertTemplates(organization, ["Server checks"])
    await grant(db, template!.id, { organization, teamId }, "view")

    expect((await getTemplate(template!.id)).status).toBe(200)
  })

  test("refuses a template the member can't see with not_found", async () => {
    const { organization } = await signedInMember("viewer")
    const [template] = await insertTemplates(organization, ["Server checks"])

    const response = await getTemplate(template!.id)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe("not_found")
  })

  test("refuses another organization's template with not_found", async () => {
    const other = await createOrganization(db)
    const [template] = await insertTemplates(other, ["Server checks"])
    await signedInMember("owner")

    const response = await getTemplate(template!.id)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe("not_found")
  })

  test("refuses an ID that doesn't exist with not_found", async () => {
    await signedInMember("owner")

    const response = await getTemplate(typeIdForTable("templates").toString())

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe("not_found")
  })

  test.each([
    ["an ID that isn't a TypeID", "not-an-id"],
    ["an ID for another table", typeIdForTable("runs").toString()],
  ])("refuses %s with validation_failed", async (_description, templateId) => {
    await signedInMember("owner")

    const response = await getTemplate(templateId)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("validation_failed")
  })

  test("refuses a signed-out request with unauthorized", async () => {
    const response = await getTemplate(typeIdForTable("templates").toString())

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe("unauthorized")
  })
})

describe("PATCH /api/templates/:templateId", () => {
  function updateTemplate(templateId: string, body: unknown) {
    return request(createApp()).patch(`/api/templates/${templateId}`).send(body as object)
  }

  async function storedTemplate(templateId: string) {
    const [row] = await db.select().from(templates).where(eq(templates.id, templateId))
    return row!
  }

  async function templateWithDescription(organization: Organization, createdBy?: string) {
    const [template] = await insertTemplates(organization, ["Server checks"], createdBy)
    const [withDescription] = await db.update(templates).set({ description: "Weekly" }).where(eq(templates.id, template!.id)).returning()
    return withDescription!
  }

  test("renames the template and responds with it", async () => {
    const { organization } = await signedInMember("admin")
    const template = await templateWithDescription(organization)

    const response = await updateTemplate(template.id, { name: "Database checks" })

    expect(response.status).toBe(200)
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

    expect(response.status).toBe(200)
    expect(await storedTemplate(template.id)).toMatchObject({ name: "Server checks", description: "Daily" })
  })

  test("clears the description when it's null", async () => {
    const { organization } = await signedInMember("admin")
    const template = await templateWithDescription(organization)

    const response = await updateTemplate(template.id, { description: null })

    expect(response.status).toBe(200)
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

    expect((await updateTemplate(template.id, { name: "Server checks" })).status).toBe(200)
  })

  test("leaves other templates alone", async () => {
    const { organization } = await signedInMember("admin")
    const [template, other] = await insertTemplates(organization, ["Server checks", "Backups"])

    await updateTemplate(template!.id, { name: "Database checks" })

    expect((await storedTemplate(other!.id)).name).toBe("Backups")
  })

  test.each(["owner", "admin"])("lets an %s update any template", async (role) => {
    const { organization } = await signedInMember(role)
    const [template] = await insertTemplates(organization, ["Server checks"])

    expect((await updateTemplate(template!.id, { name: "Database checks" })).status).toBe(200)
  })

  test.each(["editor", "viewer"])("lets an %s update a template they created", async (role) => {
    const { organization, member } = await signedInMember(role)
    const [template] = await insertTemplates(organization, ["Server checks"], member.userId)

    expect((await updateTemplate(template!.id, { name: "Database checks" })).status).toBe(200)
  })

  test("lets a member with edit access update the template", async () => {
    const { organization, member } = await signedInMember("viewer")
    const [template] = await insertTemplates(organization, ["Server checks"])
    await grant(db, template!.id, { organization, memberId: member.id }, "edit")

    expect((await updateTemplate(template!.id, { name: "Database checks" })).status).toBe(200)
  })

  test("lets a member whose group has edit access update the template", async () => {
    const { organization, member } = await signedInMember("viewer")
    const teamId = await createGroup(db, organization)
    await addToGroup(db, teamId, member)
    const [template] = await insertTemplates(organization, ["Server checks"])
    await grant(db, template!.id, { organization, teamId }, "edit")

    expect((await updateTemplate(template!.id, { name: "Database checks" })).status).toBe(200)
  })

  test.each(["view", "run"] as const)("refuses a member with only %s access with not_found and changes nothing", async (level) => {
    const { organization, member } = await signedInMember("viewer")
    const [template] = await insertTemplates(organization, ["Server checks"])
    await grant(db, template!.id, { organization, memberId: member.id }, level)

    const response = await updateTemplate(template!.id, { name: "Database checks" })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe("not_found")
    expect((await storedTemplate(template!.id)).name).toBe("Server checks")
  })

  test("refuses a template the member can't see with not_found", async () => {
    const { organization } = await signedInMember("editor")
    const [template] = await insertTemplates(organization, ["Server checks"])

    const response = await updateTemplate(template!.id, { name: "Database checks" })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe("not_found")
    expect((await storedTemplate(template!.id)).name).toBe("Server checks")
  })

  test("refuses another organization's template with not_found and changes nothing", async () => {
    const other = await createOrganization(db)
    const [template] = await insertTemplates(other, ["Server checks"])
    await signedInMember("owner")

    const response = await updateTemplate(template!.id, { name: "Database checks" })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe("not_found")
    expect((await storedTemplate(template!.id)).name).toBe("Server checks")
  })

  test("refuses an ID that doesn't exist with not_found", async () => {
    await signedInMember("owner")

    const response = await updateTemplate(typeIdForTable("templates").toString(), { name: "Database checks" })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe("not_found")
  })

  test("refuses another active template's name with validation_failed on the name", async () => {
    const { organization } = await signedInMember("admin")
    const [template] = await insertTemplates(organization, ["Server checks", "Backups"])

    const response = await updateTemplate(template!.id, { name: "Backups" })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("validation_failed")
    expect(response.body.error.details).toEqual([{ location: "body", path: ["name"], message: expect.any(String) }])
    expect((await storedTemplate(template!.id)).name).toBe("Server checks")
  })

  test("allows the name of an archived template", async () => {
    const { organization } = await signedInMember("admin")
    const [template, archived] = await insertTemplates(organization, ["Server checks", "Backups"])
    await db.update(templates).set({ status: "archived" }).where(eq(templates.id, archived!.id))

    const response = await updateTemplate(template!.id, { name: "Backups" })

    expect(response.status).toBe(200)
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

    const response = await updateTemplate(template.id, body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("validation_failed")
    expect(await storedTemplate(template.id)).toEqual(template)
  })

  test("refuses an ID that isn't a template TypeID with validation_failed", async () => {
    await signedInMember("owner")

    const response = await updateTemplate(typeIdForTable("runs").toString(), { name: "Database checks" })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("validation_failed")
  })

  test("refuses a signed-out request with unauthorized", async () => {
    const response = await updateTemplate(typeIdForTable("templates").toString(), { name: "Database checks" })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe("unauthorized")
  })
})
