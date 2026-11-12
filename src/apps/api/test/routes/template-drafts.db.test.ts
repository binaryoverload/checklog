import { eq } from "drizzle-orm"
import { describe, expect, test } from "vitest"

import { members, teams } from "@/db/auth-schema.ts"
import { db } from "@/db/index.ts"
import { templateFields, templateSteps } from "@/db/schema.ts"
import type { TemplateStep } from "@/util/types.ts"
import type { TemplateFieldDto, TemplateStepDto, TemplateVersionDto } from "@checklog/shared/api"
import { typeIdForTable } from "@checklog/shared/utils"
import {
  createGroup,
  createMember,
  createOrganization,
  expectCreationKept,
  insertTemplateField,
  insertTemplateStep,
  insertTemplateVersion,
} from "@test/support/database.ts"
import { api, expectError, expectStatus } from "@test/support/http.ts"
import { signedInMember, stubSessions } from "@test/support/session.ts"
import { draftIn, draftStepIn, draftWithSteps, publishedWithDraft, publishedWithSteps, stepsOf, storedStep, titlesOf, versionsOf } from "@test/support/template-drafts.ts"
import { describeTemplateAccess } from "@test/support/template-routes.ts"
import type { TemplateRoute } from "@test/support/template-routes.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates.

stubSessions()

// A version as GET and POST /draft return it, with its steps and their fields in position order
type VersionWithSteps = TemplateVersionDto & { steps: (TemplateStepDto & { fields: TemplateFieldDto[] })[] }

const draftRoutes: TemplateRoute[] = [
  {
    name: "GET /api/templates/:templateId/draft",
    send: id => api().get(`/api/templates/${id}/draft`),
    needs: "view",
    impersonation: "allow",
    status: "active",
  },
  {
    name: "POST /api/templates/:templateId/draft",
    send: id => api().post(`/api/templates/${id}/draft`),
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
  },
  {
    name: "POST /api/templates/:templateId/draft/steps",
    send: async (id) => {
      await draftIn(id)
      return api().post(`/api/templates/${id}/draft/steps`).send({ title: "New step" })
    },
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
  },
  {
    name: "PATCH /api/templates/:templateId/draft/steps/:stepId",
    send: async (id) => {
      const step = await draftStepIn(id)
      return api().patch(`/api/templates/${id}/draft/steps/${step.id}`).send({ title: "Renamed", updatedAt: step.updatedAt.toISOString() })
    },
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
  },
  {
    name: "PUT /api/templates/:templateId/draft/steps/order",
    send: async (id) => {
      const step = await draftStepIn(id)
      return api().put(`/api/templates/${id}/draft/steps/order`).send({ stepIds: [step.id] })
    },
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
  },
  {
    name: "DELETE /api/templates/:templateId/draft/steps/:stepId",
    send: async (id) => {
      const step = await draftStepIn(id)
      return api().delete(`/api/templates/${id}/draft/steps/${step.id}`)
    },
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
    successStatus: 204,
  },
]

describeTemplateAccess(draftRoutes)

describe("GET /api/templates/:templateId/draft", () => {
  const getDraft = (templateId: string) => api().get(`/api/templates/${templateId}/draft`)

  test("returns the draft with its steps and their fields in position order", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    const second = await insertTemplateStep(db, draft, { title: "Second", position: 1 })
    const first = await insertTemplateStep(db, draft, { title: "First", position: 0 })
    await insertTemplateField(db, first, { key: "later", position: 1 })
    await insertTemplateField(db, first, { key: "earlier", position: 0 })
    await insertTemplateField(db, second, { key: "other" })

    const response = await getDraft(template.id)

    expectStatus(response, 200)
    const draftVersion = (response.body as { draftVersion: VersionWithSteps }).draftVersion
    expect(draftVersion).toMatchObject({ id: draft.id, version: 1, status: "draft" })
    expect(draftVersion.steps.map(step => step.title)).toEqual(["First", "Second"])
    expect(draftVersion.steps.map(step => step.fields.map(field => field.key))).toEqual([["earlier", "later"], ["other"]])
  })

  test("returns steps and fields as DTOs, without the organization", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])
    await db.update(templateSteps).set({ assigneeType: "member", assigneeMemberId: member.id }).where(eq(templateSteps.id, step!.id))
    await insertTemplateField(db, step!, { key: "reading", type: "number", options: { type: "number", unit: "°C" } })

    const draftVersion = ((await getDraft(template.id)).body as { draftVersion: VersionWithSteps }).draftVersion

    expect(draftVersion).not.toHaveProperty("organizationId")
    expect(draftVersion.steps[0]).toMatchObject({ assignee: { type: "member", memberId: member.id }, assigneeMissing: false })
    expect(draftVersion.steps[0]).not.toHaveProperty("organizationId")
    expect(draftVersion.steps[0]!.fields[0]).toMatchObject({ key: "reading", type: "number", options: { type: "number", unit: "°C" } })
    expect(draftVersion.steps[0]!.fields[0]).not.toHaveProperty("organizationId")
  })

  test("returns an empty draft with no steps", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization)

    const response = await getDraft(template.id)

    expect((response.body as { draftVersion: VersionWithSteps }).draftVersion.steps).toEqual([])
  })

  test("returns null when the template has no draft, without the published version's steps", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await publishedWithSteps(organization, ["Published"])

    const response = await getDraft(template.id)

    expectStatus(response, 200)
    expect(response.body).toEqual({ draftVersion: null })
  })

  test("returns only the draft's steps when there's also a published version", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await publishedWithDraft(organization, ["Draft step"])

    const draftVersion = ((await getDraft(template.id)).body as { draftVersion: VersionWithSteps }).draftVersion

    expect(draftVersion.id).toBe(draft.id)
    expect(draftVersion.steps.map(step => step.title)).toEqual(["Draft step"])
  })

  test("creates no draft", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithSteps(organization, ["Published"])

    expectStatus(await getDraft(template.id), 200)

    expect((await versionsOf(template)).map(version => version.id)).toEqual([published.id])
  })
})

describe("POST /api/templates/:templateId/draft", () => {
  const startEditing = (templateId: string) => api().post(`/api/templates/${templateId}/draft`)

  test("copies the current version's steps and fields into a new draft and leaves the current version as it was", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [first] } = await publishedWithSteps(organization, ["First", "Second"])
    await insertTemplateField(db, first!, { key: "reading" })

    expectStatus(await startEditing(template.id), 200)

    const versions = await versionsOf(template)
    expect(versions.map(version => [version.version, version.status])).toEqual([[1, "published"], [2, "draft"]])
    expect(await titlesOf(versions[1]!)).toEqual(["First", "Second"])
    const draftFields = await db.select().from(templateFields).where(eq(templateFields.templateVersionId, versions[1]!.id))
    expect(draftFields.map(field => field.key)).toEqual(["reading"])
    expect(await titlesOf(published)).toEqual(["First", "Second"])
  })

  test("returns the new draft with the copied steps and fields", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [first] } = await publishedWithSteps(organization, ["First", "Second"])
    await insertTemplateField(db, first!, { key: "reading" })

    const response = await startEditing(template.id)

    const draftVersion = (response.body as { draftVersion: VersionWithSteps }).draftVersion
    expect(draftVersion).toMatchObject({ version: 2, status: "draft" })
    expect(draftVersion.id).not.toBe(published.id)
    expect(draftVersion.steps.map(step => step.title)).toEqual(["First", "Second"])
    expect(draftVersion.steps.every(step => step.templateVersionId === draftVersion.id)).toBe(true)
    expect(draftVersion.steps.map(step => step.fields.map(field => field.key))).toEqual([["reading"], []])
    expect(draftVersion.steps[0]!.fields[0]!.templateStepId).toBe(draftVersion.steps[0]!.id)
  })

  test("returns an existing draft with its steps", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization, ["Edited"])

    const draftVersion = ((await startEditing(template.id)).body as { draftVersion: VersionWithSteps }).draftVersion

    expect(draftVersion.id).toBe(draft.id)
    expect(draftVersion.steps.map(step => step.title)).toEqual(["Edited"])
  })

  test("keeps an existing draft and its steps, without making another", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization, ["Edited"])

    expectStatus(await startEditing(template.id), 200)

    expect((await versionsOf(template)).map(version => version.id)).toEqual([draft.id])
    expect(await titlesOf(draft)).toEqual(["Edited"])
  })

  test("makes one draft when it's called twice", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await publishedWithSteps(organization, ["First"])

    expectStatus(await startEditing(template.id), 200)
    expectStatus(await startEditing(template.id), 200)

    expect((await versionsOf(template)).map(version => version.status)).toEqual(["published", "draft"])
  })
})

describe("POST /api/templates/:templateId/draft/steps", () => {
  const addStep = (templateId: string, body: object) => api().post(`/api/templates/${templateId}/draft/steps`).send(body)

  test("adds a step at the end of the draft and returns it", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization, ["First", "Second"])

    const response = await addStep(template.id, { title: "Third" })

    expectStatus(response, 200)
    const body = response.body as TemplateStepDto
    expect(body).toMatchObject({ templateVersionId: draft.id, title: "Third", position: 2, createdBy: member.userId })
    expect(body).not.toHaveProperty("organizationId")
    expect(await storedStep(body.id)).toBeDefined()
    expect(await titlesOf(draft)).toEqual(["First", "Second", "Third"])
  })

  test("adds the first step to an empty draft at position 0", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)

    const response = await addStep(template.id, { title: "Only" })

    expectStatus(response, 200)
    expect((await stepsOf(draft)).map(step => step.position)).toEqual([0])
  })

  test.each([
    [0, ["New", "First", "Second", "Third"]],
    [1, ["First", "New", "Second", "Third"]],
    [3, ["First", "Second", "Third", "New"]],
  ])("inserts at position %i and moves the later steps down", async (position, titles) => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization, ["First", "Second", "Third"])

    expectStatus(await addStep(template.id, { title: "New", position }), 200)

    const steps = await stepsOf(draft)
    expect(steps.map(step => step.title)).toEqual(titles)
    expect(steps.map(step => step.position)).toEqual([0, 1, 2, 3])
  })

  test("gives a step with only a title the default settings", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization)

    const response = await addStep(template.id, { title: "Defaults" })

    expect(response.body).toMatchObject({
      kind: "task",
      instructions: null,
      isHalt: false,
      skippable: false,
      assignee: null,
      dueOffset: null,
    })
  })

  test("stores every setting it's given", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization)

    const response = await addStep(template.id, {
      title: "Sign off",
      instructions: "Check the readings",
      kind: "approval",
      isHalt: true,
      assignee: { type: "member", memberId: member.id },
      dueOffset: "P3D",
    })

    expectStatus(response, 200)
    expect(await storedStep((response.body as TemplateStepDto).id)).toMatchObject({
      title: "Sign off",
      instructions: "Check the readings",
      kind: "approval",
      isHalt: true,
      skippable: false,
      assigneeType: "member",
      assigneeMemberId: member.id,
      assigneeTeamId: null,
      assigneeRole: null,
      dueOffset: "P3D",
    })
  })

  test("assigns a group in the organization", async () => {
    const { organization } = await signedInMember("owner")
    const teamId = await createGroup(db, organization)
    const { template } = await draftWithSteps(organization)

    const response = await addStep(template.id, { title: "Grouped", assignee: { type: "team", teamId } })

    expect(response.body).toMatchObject({ assignee: { type: "team", teamId: teamId } })
  })

  test("assigns a role", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization)

    const response = await addStep(template.id, { title: "By role", assignee: { type: "role", role: "editor" } })

    expect(response.body).toMatchObject({ assignee: { type: "role", role: "editor" } })
  })

  test("keeps the due offset exactly as entered", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization)

    const response = await addStep(template.id, { title: "Later", dueOffset: "PT36H" })

    expect(response.body.dueOffset).toBe("PT36H")
  })

  test("refuses a template with no draft with conflict and creates no draft", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithSteps(organization, ["First", "Second"])

    expectError(await addStep(template.id, { title: "Third" }), 409, "conflict")
    expect((await versionsOf(template)).map(version => version.id)).toEqual([published.id])
    expect(await titlesOf(published)).toEqual(["First", "Second"])
  })

  test.each([
    ["no title", {}],
    ["an empty title", { title: "" }],
    ["a negative position", { title: "Step", position: -1 }],
    ["a position that isn't a whole number", { title: "Step", position: 1.5 }],
    ["an unknown kind", { title: "Step", kind: "checklist" }],
    ["a due offset that isn't an ISO 8601 duration", { title: "Step", dueOffset: "3 days" }],
    ["a skippable halt step", { title: "Step", isHalt: true, skippable: true }],
    ["a skippable approval step", { title: "Step", kind: "approval", skippable: true }],
    ["a member assignee without a member ID", { title: "Step", assignee: { type: "member" } }],
    ["a member assignee given a group ID", { title: "Step", assignee: { type: "member", teamId: typeIdForTable("team").toString() } }],
    ["an unknown assignee type", { title: "Step", assignee: { type: "everyone" } }],
  ])("refuses %s with validation_failed and adds nothing", async (_description, body) => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization, ["First"])

    expectError(await addStep(template.id, body), 400, "validation_failed")
    expect(await titlesOf(draft)).toEqual(["First"])
  })

  test("refuses a member from another organization as the assignee with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { member: outsider } = await createMember(db, await createOrganization(db), "editor")
    const { template, draft } = await draftWithSteps(organization)

    expectError(await addStep(template.id, { title: "Step", assignee: { type: "member", memberId: outsider.id } }), 400, "validation_failed")
    expect(await stepsOf(draft)).toEqual([])
  })

  test("refuses a group from another organization as the assignee with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const teamId = await createGroup(db, await createOrganization(db))
    const { template, draft } = await draftWithSteps(organization)

    expectError(await addStep(template.id, { title: "Step", assignee: { type: "team", teamId } }), 400, "validation_failed")
    expect(await stepsOf(draft)).toEqual([])
  })
})

describe("PATCH /api/templates/:templateId/draft/steps/:stepId", () => {
  const editStep = (templateId: string, step: { id: string, updatedAt: Date }, body: object) =>
    api().patch(`/api/templates/${templateId}/draft/steps/${step.id}`).send({ updatedAt: step.updatedAt.toISOString(), ...body })

  test("keeps who created the step, and when", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])

    expectStatus(await editStep(template.id, step!, { title: "Renamed" }), 200)

    expectCreationKept(step!, await storedStep(step!.id))
  })

  test("changes only the settings it's given and returns the step", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    const step = await insertTemplateStep(db, draft, { title: "Original", instructions: "Keep these", dueOffset: "P1D" })

    const response = await editStep(template.id, step, { title: "Renamed" })

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ id: step.id, title: "Renamed", instructions: "Keep these", dueOffset: "P1D" })
    expect(response.body).not.toHaveProperty("organizationId")
    expect(await storedStep(step.id)).toMatchObject({ title: "Renamed", instructions: "Keep these", dueOffset: "P1D" })
  })

  test("moves updatedAt forward, so the old value can't be used again", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])

    const first = await editStep(template.id, step!, { title: "Once" })
    const second = await editStep(template.id, step!, { title: "Twice" })

    expect(new Date((first.body as TemplateStepDto).updatedAt).getTime()).toBeGreaterThan(step!.updatedAt.getTime())
    expectError(second, 409, "conflict")
    expect((await storedStep(step!.id))!.title).toBe("Once")
  })

  test("refuses an edit made from an out-of-date copy with conflict and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])

    expectError(await editStep(template.id, { id: step!.id, updatedAt: new Date(step!.updatedAt.getTime() - 1000) }, { title: "Stale" }), 409, "conflict")
    expect(await storedStep(step!.id)).toEqual(step)
  })

  test("refuses an edit without updatedAt with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])

    expectError(await api().patch(`/api/templates/${template.id}/draft/steps/${step!.id}`).send({ title: "Renamed" }), 400, "validation_failed")
  })

  test("changes the assignee from a member to a role, clearing the member", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    const step = await insertTemplateStep(db, draft, { assigneeType: "member", assigneeMemberId: member.id })

    const response = await editStep(template.id, step, { assignee: { type: "role", role: "editor" } })

    expect(response.body).toMatchObject({ assignee: { type: "role", role: "editor" } })
    expect(await storedStep(step.id)).toMatchObject({ assigneeType: "role", assigneeRole: "editor", assigneeMemberId: null, assigneeTeamId: null })
  })

  test("clears the assignee and due offset when they're set to null", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    const step = await insertTemplateStep(db, draft, { assigneeType: "member", assigneeMemberId: member.id, dueOffset: "P1D" })

    const response = await editStep(template.id, step, { assignee: null, dueOffset: null })

    expect(response.body).toMatchObject({ assignee: null, dueOffset: null })
    expect(await storedStep(step.id)).toMatchObject({ assigneeType: null, assigneeMemberId: null, assigneeTeamId: null, assigneeRole: null, dueOffset: null })
  })

  test("leaves the settings it isn't given as they were", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    const step = await insertTemplateStep(db, draft, { kind: "approval", isHalt: true, assigneeType: "member", assigneeMemberId: member.id })

    expectStatus(await editStep(template.id, step, { title: "Renamed" }), 200)

    expect(await storedStep(step.id)).toMatchObject({ title: "Renamed", kind: "approval", isHalt: true, assigneeType: "member", assigneeMemberId: member.id })
  })

  test("makes a step an approval step when it already has an assignee", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    const step = await insertTemplateStep(db, draft, { assigneeType: "member", assigneeMemberId: member.id })

    expectStatus(await editStep(template.id, step, { kind: "approval" }), 200)

    expect((await storedStep(step.id))!.kind).toBe("approval")
  })

  test("returns no assignee, marked missing, when the assigned member has been removed", async () => {
    const { organization } = await signedInMember("owner")
    const { member: removed } = await createMember(db, organization, "editor")
    const { template, draft } = await draftWithSteps(organization)
    const step = await insertTemplateStep(db, draft, { assigneeType: "member", assigneeMemberId: removed.id })
    await db.delete(members).where(eq(members.id, removed.id))

    const response = await editStep(template.id, step, { title: "Renamed" })

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ assignee: null, assigneeMissing: true })
  })

  test("returns no assignee, marked missing, when the assigned group has been removed", async () => {
    const { organization } = await signedInMember("owner")
    const teamId = await createGroup(db, organization)
    const { template, draft } = await draftWithSteps(organization)
    const step = await insertTemplateStep(db, draft, { assigneeType: "team", assigneeTeamId: teamId })
    await db.delete(teams).where(eq(teams.id, teamId))

    const response = await editStep(template.id, step, { title: "Renamed" })

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ assignee: null, assigneeMissing: true })
  })

  test("doesn't mark an assigned or unassigned step as missing its assignee", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    const assigned = await insertTemplateStep(db, draft, { assigneeType: "member", assigneeMemberId: member.id })
    const unassigned = await insertTemplateStep(db, draft, { position: 1 })

    expect((await editStep(template.id, assigned, { title: "Renamed" })).body).toMatchObject({ assigneeMissing: false })
    expect((await editStep(template.id, unassigned, { title: "Renamed" })).body).toMatchObject({ assignee: null, assigneeMissing: false })
  })

  test("refuses making a step whose assigned member has been removed an approval step with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { member: removed } = await createMember(db, organization, "editor")
    const { template, draft } = await draftWithSteps(organization)
    const step = await insertTemplateStep(db, draft, { assigneeType: "member", assigneeMemberId: removed.id })
    await db.delete(members).where(eq(members.id, removed.id))

    expectError(await editStep(template.id, step, { kind: "approval" }), 400, "validation_failed")
    expect((await storedStep(step.id))!.kind).toBe("task")
  })

  test("refuses an edit with only updatedAt with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])

    expectError(await editStep(template.id, step!, {}), 400, "validation_failed")
    expect(await storedStep(step!.id)).toEqual(step)
  })

  test.each([
    ["making a halt step skippable", { isHalt: true }, { skippable: true }],
    ["making an approval step skippable", { kind: "approval" as const }, { skippable: true }],
    ["making a skippable step a halt step", { skippable: true }, { isHalt: true }],
    ["making a skippable step an approval step", { skippable: true }, { kind: "approval" }],
  ])("refuses %s with validation_failed and changes nothing", async (_description, existing, body) => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    const step = await insertTemplateStep(db, draft, existing)

    expectError(await editStep(template.id, step, body), 400, "validation_failed")
    expect(await storedStep(step.id)).toEqual(step)
  })

  test.each([
    ["an empty title", { title: "" }],
    ["a due offset that isn't an ISO 8601 duration", { dueOffset: "tomorrow" }],
    ["a team assignee without a group ID", { assignee: { type: "team" } }],
  ])("refuses %s with validation_failed", async (_description, body) => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])

    expectError(await editStep(template.id, step!, body), 400, "validation_failed")
    expect(await storedStep(step!.id)).toEqual(step)
  })

  test("refuses a member from another organization as the assignee with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { member: outsider } = await createMember(db, await createOrganization(db), "editor")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])

    expectError(await editStep(template.id, step!, { assignee: { type: "member", memberId: outsider.id } }), 400, "validation_failed")
    expect(await storedStep(step!.id)).toEqual(step)
  })

  test("refuses a template with no draft with conflict and creates no draft", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [publishedStep] } = await publishedWithSteps(organization, ["Published"])

    expectError(await editStep(template.id, publishedStep!, { title: "Changed" }), 409, "conflict")
    expect((await versionsOf(template)).map(version => version.id)).toEqual([published.id])
    expect(await storedStep(publishedStep!.id)).toEqual(publishedStep)
  })

  test("refuses a step from the published version with not_found and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [publishedStep] } = await publishedWithSteps(organization, ["Published"])
    await insertTemplateVersion(db, template, 2, "draft")

    expectError(await editStep(template.id, publishedStep!, { title: "Changed" }), 404, "not_found")
    expect(await storedStep(publishedStep!.id)).toEqual(publishedStep)
  })

  test("refuses a step from another template's draft with not_found and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization, ["Mine"])
    const { steps: [otherStep] } = await draftWithSteps(organization, ["Other"])

    expectError(await editStep(template.id, otherStep!, { title: "Changed" }), 404, "not_found")
    expect(await storedStep(otherStep!.id)).toEqual(otherStep)
  })

  test("refuses a step ID that doesn't exist with not_found", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization, ["Step"])

    expectError(await editStep(template.id, { id: typeIdForTable("templateSteps").toString(), updatedAt: new Date() }, { title: "Changed" }), 404, "not_found")
  })

  test("refuses a step ID for another table with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization, ["Step"])

    expectError(await editStep(template.id, { id: typeIdForTable("templateFields").toString(), updatedAt: new Date() }, { title: "Changed" }), 400, "validation_failed")
  })
})

describe("PUT /api/templates/:templateId/draft/steps/order", () => {
  const reorder = (templateId: string, stepIds: string[]) => api().put(`/api/templates/${templateId}/draft/steps/order`).send({ stepIds })

  test("keeps who created each step, and when", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps } = await draftWithSteps(organization, ["First", "Second"])

    expectStatus(await reorder(template.id, [steps[1]!.id, steps[0]!.id]), 200)

    for (const step of steps) expectCreationKept(step, await storedStep(step.id))
  })

  test("puts the steps in the given order", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft, steps: [first, second, third] } = await draftWithSteps(organization, ["First", "Second", "Third"])

    expectStatus(await reorder(template.id, [third!.id, first!.id, second!.id]), 200)

    const steps = await stepsOf(draft)
    expect(steps.map(step => step.title)).toEqual(["Third", "First", "Second"])
    expect(steps.map(step => step.position)).toEqual([0, 1, 2])
  })

  test("returns the steps in their new order", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [first, second, third] } = await draftWithSteps(organization, ["First", "Second", "Third"])

    const response = await reorder(template.id, [third!.id, first!.id, second!.id])

    const body = response.body as TemplateStepDto[]
    expect(body.map(step => [step.title, step.position])).toEqual([["Third", 0], ["First", 1], ["Second", 2]])
    expect(body[0]).not.toHaveProperty("organizationId")
  })

  test("moves each step's updatedAt forward and returns the new value", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps } = await draftWithSteps(organization, ["First", "Second"])
    const [first, second] = steps as [TemplateStep, TemplateStep]

    const response = await reorder(template.id, [second.id, first.id])

    for (const step of [first, second]) {
      const stored = (await storedStep(step.id))!
      const returned = (response.body as TemplateStepDto[]).find(dto => dto.id === step.id)!
      expect(stored.updatedAt.getTime()).toBeGreaterThan(step.updatedAt.getTime())
      expect(returned.updatedAt).toBe(stored.updatedAt.toISOString())
    }
  })

  test("rewrites positions with gaps to 0 to n−1", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    const first = await insertTemplateStep(db, draft, { title: "First", position: 4 })
    const second = await insertTemplateStep(db, draft, { title: "Second", position: 9 })

    expectStatus(await reorder(template.id, [first.id, second.id]), 200)

    expect((await stepsOf(draft)).map(step => step.position)).toEqual([0, 1])
  })

  test("accepts an empty list for a draft with no steps", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization)

    expectStatus(await reorder(template.id, []), 200)
  })

  test("refuses a template with no draft with conflict and creates no draft", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [first, second] } = await publishedWithSteps(organization, ["First", "Second"])

    expectError(await reorder(template.id, [second!.id, first!.id]), 409, "conflict")
    expect((await versionsOf(template)).map(version => version.id)).toEqual([published.id])
    expect(await titlesOf(published)).toEqual(["First", "Second"])
  })

  test("refuses a list missing a step with validation_failed and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft, steps: [first, second] } = await draftWithSteps(organization, ["First", "Second", "Third"])

    expectError(await reorder(template.id, [second!.id, first!.id]), 400, "validation_failed")
    expect(await titlesOf(draft)).toEqual(["First", "Second", "Third"])
  })

  test("refuses a list with a step twice with validation_failed and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft, steps: [first, second] } = await draftWithSteps(organization, ["First", "Second"])

    expectError(await reorder(template.id, [second!.id, first!.id, second!.id]), 400, "validation_failed")
    expect(await titlesOf(draft)).toEqual(["First", "Second"])
  })

  test("refuses a list with a step from another template with validation_failed and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft, steps: [first, second] } = await draftWithSteps(organization, ["First", "Second"])
    const { steps: [otherStep] } = await draftWithSteps(organization, ["Other"])

    expectError(await reorder(template.id, [second!.id, first!.id, otherStep!.id]), 400, "validation_failed")
    expect(await titlesOf(draft)).toEqual(["First", "Second"])
  })

  test("refuses a list with an ID for another table with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [first] } = await draftWithSteps(organization, ["First"])

    expectError(await reorder(template.id, [first!.id, typeIdForTable("templateFields").toString()]), 400, "validation_failed")
  })

  test("refuses a body without stepIds with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization, ["First"])

    expectError(await api().put(`/api/templates/${template.id}/draft/steps/order`).send({}), 400, "validation_failed")
  })
})

describe("DELETE /api/templates/:templateId/draft/steps/:stepId", () => {
  const deleteStep = (templateId: string, stepId: string) => api().delete(`/api/templates/${templateId}/draft/steps/${stepId}`)

  test("keeps who created the steps it renumbers, and when", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [first, second] } = await draftWithSteps(organization, ["First", "Second"])

    expectStatus(await deleteStep(template.id, first!.id), 204)

    expectCreationKept(second!, await storedStep(second!.id))
  })

  test("removes the step and closes the gap in positions", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft, steps: [, second] } = await draftWithSteps(organization, ["First", "Second", "Third"])

    const response = await deleteStep(template.id, second!.id)

    expectStatus(response, 204)
    expect(response.text).toBe("")

    const steps = await stepsOf(draft)
    expect(steps.map(step => step.title)).toEqual(["First", "Third"])
    expect(steps.map(step => step.position)).toEqual([0, 1])
  })

  test("moves the updatedAt of the steps it renumbers forward", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [first, second, third] } = await draftWithSteps(organization, ["First", "Second", "Third"])

    expectStatus(await deleteStep(template.id, first!.id), 204)

    expect((await storedStep(second!.id))!.updatedAt.getTime()).toBeGreaterThan(second!.updatedAt.getTime())
    expect((await storedStep(third!.id))!.updatedAt.getTime()).toBeGreaterThan(third!.updatedAt.getTime())
  })

  test("keeps the other steps in their order when they were added out of order", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    await insertTemplateStep(db, draft, { title: "Third", position: 2 })
    const first = await insertTemplateStep(db, draft, { title: "First", position: 0 })
    await insertTemplateStep(db, draft, { title: "Second", position: 1 })

    expectStatus(await deleteStep(template.id, first.id), 204)

    const steps = await stepsOf(draft)
    expect(steps.map(step => step.title)).toEqual(["Second", "Third"])
    expect(steps.map(step => step.position)).toEqual([0, 1])
  })

  test("removes the step's fields and leaves other steps' fields", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft, steps: [kept, removed] } = await draftWithSteps(organization, ["Kept", "Removed"])
    const keptField = await insertTemplateField(db, kept!)
    await insertTemplateField(db, removed!)

    expectStatus(await deleteStep(template.id, removed!.id), 204)

    const fields = await db.select().from(templateFields).where(eq(templateFields.templateVersionId, draft.id))
    expect(fields.map(field => field.id)).toEqual([keptField.id])
  })

  test("refuses a template with no draft with conflict and deletes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [publishedStep] } = await publishedWithSteps(organization, ["Published"])

    expectError(await deleteStep(template.id, publishedStep!.id), 409, "conflict")
    expect((await versionsOf(template)).map(version => version.id)).toEqual([published.id])
    expect(await titlesOf(published)).toEqual(["Published"])
  })

  test("refuses a step from the published version with not_found and deletes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [publishedStep] } = await publishedWithSteps(organization, ["Published"])
    await insertTemplateVersion(db, template, 2, "draft")

    expectError(await deleteStep(template.id, publishedStep!.id), 404, "not_found")
    expect(await titlesOf(published)).toEqual(["Published"])
  })

  test("refuses a step from another template's draft with not_found and deletes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization, ["Mine"])
    const { draft: otherDraft, steps: [otherStep] } = await draftWithSteps(organization, ["Other"])

    expectError(await deleteStep(template.id, otherStep!.id), 404, "not_found")
    expect(await titlesOf(otherDraft)).toEqual(["Other"])
  })

  test("refuses a step ID that doesn't exist with not_found", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await draftWithSteps(organization, ["Step"])

    expectError(await deleteStep(template.id, typeIdForTable("templateSteps").toString()), 404, "not_found")
  })

  test("refuses a step that's already been deleted with not_found", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])

    expectStatus(await deleteStep(template.id, step!.id), 204)
    expectError(await deleteStep(template.id, step!.id), 404, "not_found")
  })
})
