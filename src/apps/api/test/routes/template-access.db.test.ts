import { asc, eq } from "drizzle-orm"
import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import { templateAccess, templates } from "@/db/schema.ts"
import type { Organization } from "@/util/types.ts"
import type { TemplateAccessDto } from "@checklog/shared/api"
import { typeIdForModel, typeIdForTable } from "@checklog/shared/utils"
import { createGroup, createMember, createOrganization, grant, insertTemplate } from "@test/support/database.ts"
import { signedInMember, stubSessions } from "@test/support/session.ts"
import { api, describeTemplateAccess, expectError, expectStatus } from "@test/support/template-routes.ts"
import type { TemplateRoute } from "@test/support/template-routes.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates.

stubSessions()

// A grant as GET /access lists it, with the member's or group's name
type GrantWithName = TemplateAccessDto & { name: string }

async function templateRow(templateId: string) {
  const [row] = await db.select().from(templates).where(eq(templates.id, templateId))
  return row
}

// Gives the access tests a group in the template's organization, or an unused group ID when the template doesn't exist
async function groupFor(templateId: string) {
  const template = await templateRow(templateId)
  return template ? createGroup(db, { id: template.organizationId } as Organization) : typeIdForModel("team").toString()
}

// Gives the access tests a grant to revoke, or an unused grant ID when the template doesn't exist
async function grantFor(templateId: string) {
  const template = await templateRow(templateId)
  if (!template) return typeIdForTable("templateAccess").toString()
  return insertGrant(templateId, template.organizationId, { teamId: await groupFor(templateId) }, "view")
}

async function insertGrant(templateId: string, organizationId: string, to: { memberId?: string, teamId?: string }, level: "view" | "run" | "edit") {
  const [row] = await db.insert(templateAccess).values({ organizationId, templateId, ...to, level, createdBy: "user_test" }).returning()
  return row!.id
}

async function grantsOn(templateId: string) {
  return db.select().from(templateAccess).where(eq(templateAccess.templateId, templateId)).orderBy(asc(templateAccess.id))
}

async function storedGrant(accessId: string) {
  const [row] = await db.select().from(templateAccess).where(eq(templateAccess.id, accessId))
  return row
}

const accessRoutes: TemplateRoute[] = [
  {
    name: "GET /api/templates/:templateId/access",
    send: id => api().get(`/api/templates/${id}/access`),
    needs: "edit",
    impersonation: "allow",
    status: "active",
  },
  {
    name: "PUT /api/templates/:templateId/access",
    send: async id => api().put(`/api/templates/${id}/access`).send({ teamId: await groupFor(id), level: "view" }),
    needs: "edit",
    impersonation: "refuse",
    status: "active",
  },
  {
    name: "DELETE /api/templates/:templateId/access/:accessId",
    send: async id => api().delete(`/api/templates/${id}/access/${await grantFor(id)}`),
    needs: "edit",
    impersonation: "refuse",
    status: "active",
    successStatus: 204,
  },
]

describeTemplateAccess(accessRoutes)

describe("GET /api/templates/:templateId/access", () => {
  const listGrants = (templateId: string) => api().get(`/api/templates/${templateId}/access`)

  test("returns every grant on the template with the member's or group's name", async () => {
    const { organization } = await signedInMember("owner")
    const { member } = await createMember(db, organization, "viewer")
    const teamId = await createGroup(db, organization)
    const template = await insertTemplate(db, organization)
    const memberGrant = await insertGrant(template.id, organization.id, { memberId: member.id }, "run")
    const groupGrant = await insertGrant(template.id, organization.id, { teamId }, "edit")

    const response = await listGrants(template.id)

    expectStatus(response, 200)
    const body = response.body as GrantWithName[]
    expect(body).toHaveLength(2)
    expect(body.find(row => row.id === memberGrant)).toMatchObject({ templateId: template.id, memberId: member.id, teamId: null, level: "run", name: "Test viewer" })
    expect(body.find(row => row.id === groupGrant)).toMatchObject({ templateId: template.id, memberId: null, teamId, level: "edit", name: "Test group" })
    expect(body[0]).not.toHaveProperty("organizationId")
  })

  test("returns only this template's grants", async () => {
    const { organization } = await signedInMember("owner")
    const { member } = await createMember(db, organization, "viewer")
    const template = await insertTemplate(db, organization)
    const other = await insertTemplate(db, organization)
    const mine = await insertGrant(template.id, organization.id, { memberId: member.id }, "view")
    await insertGrant(other.id, organization.id, { memberId: member.id }, "edit")

    const body = (await listGrants(template.id)).body as GrantWithName[]

    expect(body.map(row => row.id)).toEqual([mine])
  })

  test("returns an empty list for a template with no grants", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization)

    expect((await listGrants(template.id)).body).toEqual([])
  })
})

describe("PUT /api/templates/:templateId/access", () => {
  const putGrant = (templateId: string, body: object) => api().put(`/api/templates/${templateId}/access`).send(body)

  test("grants a member a level and returns the grant", async () => {
    const { organization, member: signedIn } = await signedInMember("owner")
    const { member } = await createMember(db, organization, "viewer")
    const template = await insertTemplate(db, organization)

    const response = await putGrant(template.id, { memberId: member.id, level: "run" })

    expectStatus(response, 200)
    const body = response.body as TemplateAccessDto
    expect(body).toMatchObject({ templateId: template.id, memberId: member.id, teamId: null, level: "run", createdBy: signedIn.userId })
    expect(body).not.toHaveProperty("organizationId")
    expect(await storedGrant(body.id)).toMatchObject({ organizationId: organization.id, templateId: template.id, memberId: member.id, teamId: null, level: "run" })
  })
  test("grants a group a level", async () => {
    const { organization } = await signedInMember("owner")
    const teamId = await createGroup(db, organization)
    const template = await insertTemplate(db, organization)

    const response = await putGrant(template.id, { teamId, level: "edit" })

    expectStatus(response, 200)
    expect(await grantsOn(template.id)).toMatchObject([{ memberId: null, teamId, level: "edit" }])
  })

  test("changes the level of a member's existing grant, keeping one grant", async () => {
    const { organization } = await signedInMember("owner")
    const { member } = await createMember(db, organization, "viewer")
    const template = await insertTemplate(db, organization)
    const existing = await insertGrant(template.id, organization.id, { memberId: member.id }, "view")

    const response = await putGrant(template.id, { memberId: member.id, level: "edit" })

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ id: existing, level: "edit" })
    expect(await grantsOn(template.id)).toMatchObject([{ id: existing, memberId: member.id, level: "edit" }])
  })

  test("changes the level of a group's existing grant, keeping one grant", async () => {
    const { organization } = await signedInMember("owner")
    const teamId = await createGroup(db, organization)
    const template = await insertTemplate(db, organization)
    const existing = await insertGrant(template.id, organization.id, { teamId }, "edit")

    expectStatus(await putGrant(template.id, { teamId, level: "view" }), 200)

    expect(await grantsOn(template.id)).toMatchObject([{ id: existing, teamId, level: "view" }])
  })

  test("leaves the member's grants on other templates as they were", async () => {
    const { organization } = await signedInMember("owner")
    const { member } = await createMember(db, organization, "viewer")
    const template = await insertTemplate(db, organization)
    const other = await insertTemplate(db, organization)
    const otherGrant = await insertGrant(other.id, organization.id, { memberId: member.id }, "view")

    expectStatus(await putGrant(template.id, { memberId: member.id, level: "edit" }), 200)

    expect(await storedGrant(otherGrant)).toMatchObject({ level: "view" })
  })

  test("keeps a member's grant and a group's grant separate", async () => {
    const { organization } = await signedInMember("owner")
    const { member } = await createMember(db, organization, "viewer")
    const teamId = await createGroup(db, organization, [member])
    const template = await insertTemplate(db, organization)
    await grant(db, template.id, { organization, teamId }, "view")

    expectStatus(await putGrant(template.id, { memberId: member.id, level: "edit" }), 200)

    const grants = await grantsOn(template.id)
    expect(grants).toHaveLength(2)
    expect(grants.find(row => row.teamId === teamId)).toMatchObject({ level: "view" })
  })

  test.each([
    ["both a member and a group", (memberId: string, teamId: string) => ({ memberId, teamId, level: "view" })],
    ["neither a member nor a group", () => ({ level: "view" })],
    ["no level", (memberId: string) => ({ memberId })],
    ["an unknown level", (memberId: string) => ({ memberId, level: "manage" })],
    ["member instead of memberId", (memberId: string) => ({ member: memberId, level: "view" })],
    ["a null member ID and no group", () => ({ memberId: null, level: "view" })],
  ])("refuses %s with validation_failed and grants nothing", async (_description, body) => {
    const { organization } = await signedInMember("owner")
    const { member } = await createMember(db, organization, "viewer")
    const teamId = await createGroup(db, organization)
    const template = await insertTemplate(db, organization)

    expectError(await putGrant(template.id, body(member.id, teamId)), 400, "validation_failed")
    expect(await grantsOn(template.id)).toEqual([])
  })

  test("refuses a member from another organization with validation_failed and grants nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { member: outsider } = await createMember(db, await createOrganization(db), "viewer")
    const template = await insertTemplate(db, organization)

    expectError(await putGrant(template.id, { memberId: outsider.id, level: "view" }), 400, "validation_failed")
    expect(await grantsOn(template.id)).toEqual([])
  })

  test("refuses a group from another organization with validation_failed and grants nothing", async () => {
    const { organization } = await signedInMember("owner")
    const teamId = await createGroup(db, await createOrganization(db))
    const template = await insertTemplate(db, organization)

    expectError(await putGrant(template.id, { teamId, level: "view" }), 400, "validation_failed")
    expect(await grantsOn(template.id)).toEqual([])
  })

  test("refuses a member ID that doesn't exist with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization)

    expectError(await putGrant(template.id, { memberId: typeIdForModel("member").toString(), level: "view" }), 400, "validation_failed")
    expect(await grantsOn(template.id)).toEqual([])
  })

  test("refuses a group ID that doesn't exist with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization)

    expectError(await putGrant(template.id, { teamId: typeIdForModel("team").toString(), level: "view" }), 400, "validation_failed")
    expect(await grantsOn(template.id)).toEqual([])
  })
})

describe("DELETE /api/templates/:templateId/access/:accessId", () => {
  const revoke = (templateId: string, accessId: string) => api().delete(`/api/templates/${templateId}/access/${accessId}`)

  test("removes the grant and leaves the template's other grants", async () => {
    const { organization } = await signedInMember("owner")
    const { member } = await createMember(db, organization, "viewer")
    const teamId = await createGroup(db, organization)
    const template = await insertTemplate(db, organization)
    const revoked = await insertGrant(template.id, organization.id, { memberId: member.id }, "edit")
    const kept = await insertGrant(template.id, organization.id, { teamId }, "view")

    const response = await revoke(template.id, revoked)

    expectStatus(response, 204)
    expect(response.text).toBe("")
    expect((await grantsOn(template.id)).map(row => row.id)).toEqual([kept])
  })

  test("refuses a grant on another template with not_found and keeps it", async () => {
    const { organization } = await signedInMember("owner")
    const { member } = await createMember(db, organization, "viewer")
    const template = await insertTemplate(db, organization)
    const other = await insertTemplate(db, organization)
    const otherGrant = await insertGrant(other.id, organization.id, { memberId: member.id }, "edit")

    expectError(await revoke(template.id, otherGrant), 404, "not_found")
    expect(await storedGrant(otherGrant)).toBeDefined()
  })

  test("refuses a grant ID that doesn't exist with not_found", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization)

    expectError(await revoke(template.id, typeIdForTable("templateAccess").toString()), 404, "not_found")
  })

  test("refuses a grant that's already been revoked with not_found", async () => {
    const { organization } = await signedInMember("owner")
    const { member } = await createMember(db, organization, "viewer")
    const template = await insertTemplate(db, organization)
    const accessId = await insertGrant(template.id, organization.id, { memberId: member.id }, "view")

    expectStatus(await revoke(template.id, accessId), 204)
    expectError(await revoke(template.id, accessId), 404, "not_found")
  })

  test("refuses a grant ID for another table with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization)

    expectError(await revoke(template.id, typeIdForTable("templateSteps").toString()), 400, "validation_failed")
  })
})
