import { eq } from "drizzle-orm"
import type request from "supertest"
import { describe, expect, test } from "vitest"

import { members } from "@/db/auth-schema.ts"
import { db } from "@/db/index.ts"
import { templateSteps } from "@/db/schema.ts"
import type { TemplateFieldDto, TemplateStepDto, TemplateVersionDto } from "@checklog/shared/api"
import type { FieldOptions, PreconditionIssue } from "@checklog/shared/domain"
import { typeIdForTable } from "@checklog/shared/utils"
import {
  createGroup,
  createMember,
  insertTemplate,
  insertTemplateField,
  insertTemplateStep,
  insertTemplateVersion,
  setCurrentVersion,
} from "@test/support/database.ts"
import { signedInMember, stubSessions } from "@test/support/session.ts"
import {
  draftStepIn,
  draftWithSteps,
  latestVersionIdOf,
  publishedWithDraft,
  publishedWithSteps,
  stepsOf,
  storedField,
  storedTemplate,
  storedVersion,
  titlesOf,
  versionsOf,
} from "@test/support/template-drafts.ts"
import { api, describeTemplateAccess, expectError, expectStatus } from "@test/support/template-routes.ts"
import type { TemplateRoute } from "@test/support/template-routes.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates.

stubSessions()

// A version as GET /versions/:versionId returns it, with its steps and their fields in position order
type VersionWithSteps = TemplateVersionDto & { steps: (TemplateStepDto & { fields: TemplateFieldDto[] })[] }

const noChoices: FieldOptions = { type: "dropdown", choices: [], multiple: false }

const versionRoutes: TemplateRoute[] = [
  {
    name: "POST /api/templates/:templateId/draft/publish",
    send: async (id) => {
      await draftStepIn(id)
      return api().post(`/api/templates/${id}/draft/publish`)
    },
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
  },
  {
    name: "DELETE /api/templates/:templateId/draft",
    prepare: async (template) => {
      const current = await setCurrentVersion(db, template, await insertTemplateVersion(db, template, 1, "published"))
      await insertTemplateVersion(db, template, 2, "draft")
      return current
    },
    send: id => api().delete(`/api/templates/${id}/draft`),
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
    successStatus: 204,
  },
  {
    name: "GET /api/templates/:templateId/versions",
    send: id => api().get(`/api/templates/${id}/versions`),
    needs: "view",
    impersonation: "allow",
    status: "active",
  },
  {
    name: "GET /api/templates/:templateId/versions/:versionId",
    prepare: async (template) => {
      await insertTemplateVersion(db, template, 1, "published")
    },
    send: async id => api().get(`/api/templates/${id}/versions/${await latestVersionIdOf(id)}`),
    needs: "view",
    impersonation: "allow",
    status: "active",
  },
  {
    name: "POST /api/templates/:templateId/versions/:versionId/archive",
    prepare: async (template) => {
      return setCurrentVersion(db, template, await insertTemplateVersion(db, template, 1, "published"))
    },
    send: async id => api().post(`/api/templates/${id}/versions/${await latestVersionIdOf(id)}/archive`),
    needs: "edit",
    impersonation: "refuse",
    status: "active",
  },
]

describeTemplateAccess(versionRoutes)

type StepProblem = Extract<PreconditionIssue, { resourceType: "templateStep" }>["problem"]
type VersionProblem = Extract<PreconditionIssue, { resourceType: "templateVersion" }>["problem"]

// A problem the publish check reports on a step, and on one of its fields when it's about a field
function stepProblem(problem: StepProblem, stepId: string, fieldId: string | null = null) {
  return { location: "resource", resourceType: "templateStep", problem, stepId, fieldId, message: expect.any(String) }
}

// A problem the publish check reports on the version as a whole
function versionProblem(problem: VersionProblem, versionId: string) {
  return { location: "resource", resourceType: "templateVersion", problem, versionId, message: expect.any(String) }
}

// Checks a refusal from the publish check lists exactly these problems, in any order
function expectPreconditionFailed(response: request.Response, problems: object[]) {
  expectError(response, 400, "precondition_failed")
  const details = response.body.error.details as PreconditionIssue[]
  expect(details).toHaveLength(problems.length)
  expect(details).toEqual(expect.arrayContaining(problems))
}

describe("POST /api/templates/:templateId/draft/publish", () => {
  const publish = (templateId: string) => api().post(`/api/templates/${templateId}/draft/publish`)

  test("publishes the draft, makes it the current version and returns it", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, draft } = await publishedWithDraft(organization, ["Step"])
    const before = Date.now()

    const response = await publish(template.id)

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ id: draft.id, version: 2, status: "published", publishedBy: member.userId })
    expect(response.body).not.toHaveProperty("organizationId")
    const stored = (await storedVersion(draft.id))!
    expect(stored).toMatchObject({ status: "published", publishedBy: member.userId })
    expect(stored.publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect((await storedTemplate(template.id)).currentVersionId).toBe(draft.id)
  })

  test("leaves the previous current version published", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithDraft(organization, ["Step"])

    expectStatus(await publish(template.id), 200)

    expect((await storedVersion(published.id))).toEqual(published)
    expect((await versionsOf(template)).map(version => version.status)).toEqual(["published", "published"])
  })

  test("publishes a new template's first draft", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization, ["Step"])

    expectStatus(await publish(template.id), 200)

    expect((await storedTemplate(template.id)).currentVersionId).toBe(draft.id)
    expect((await storedVersion(draft.id))!.status).toBe("published")
  })

  test("keeps the draft's own steps and fields, copying nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft, steps: [first, second] } = await publishedWithDraft(organization, ["First", "Second"])
    const field = await insertTemplateField(db, first!)

    expectStatus(await publish(template.id), 200)

    expect((await stepsOf(draft)).map(step => step.id)).toEqual([first!.id, second!.id])
    expect(await storedField(field.id)).toMatchObject({ templateVersionId: draft.id, templateStepId: first!.id })
    expect(await versionsOf(template)).toHaveLength(2)
  })

  test("publishes steps that are unassigned or assigned to a member, group or role", async () => {
    const { organization, member } = await signedInMember("owner")
    const teamId = await createGroup(db, organization)
    const { template, draft } = await draftWithSteps(organization)
    await insertTemplateStep(db, draft, { position: 0 })
    await insertTemplateStep(db, draft, { position: 1, assigneeType: "member", assigneeMemberId: member.id })
    await insertTemplateStep(db, draft, { position: 2, assigneeType: "team", assigneeTeamId: teamId })
    await insertTemplateStep(db, draft, { position: 3, assigneeType: "role", assigneeRole: "editor" })

    expectStatus(await publish(template.id), 200)
  })

  test("publishes a dropdown field with at least one choice", async () => {
    const { organization } = await signedInMember("owner")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])
    await insertTemplateField(db, step!, { type: "dropdown", options: { type: "dropdown", choices: [{ value: "ok", label: "OK" }], multiple: false } })

    expectStatus(await publish(template.id), 200)
  })

  test("refuses a template with no draft with conflict and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithSteps(organization, ["Published"])

    expectError(await publish(template.id), 409, "conflict")
    expect(await storedTemplate(template.id)).toEqual(template)
    expect(await storedVersion(published.id)).toEqual(published)
  })

  test("refuses a draft with no steps with precondition_failed and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await publishedWithDraft(organization)

    expectPreconditionFailed(await publish(template.id), [versionProblem("no_steps", draft.id)])
    expect(await storedVersion(draft.id)).toEqual(draft)
    expect(await storedTemplate(template.id)).toEqual(template)
  })

  test("refuses a step whose assigned member has been removed with precondition_failed, pointing at the step", async () => {
    const { organization } = await signedInMember("owner")
    const { member: removed } = await createMember(db, organization, "editor")
    const { template, draft } = await publishedWithDraft(organization)
    const step = await insertTemplateStep(db, draft, { assigneeType: "member", assigneeMemberId: removed.id })
    await db.delete(members).where(eq(members.id, removed.id))

    expectPreconditionFailed(await publish(template.id), [stepProblem("missing_assignee", step.id)])
    expect(await storedVersion(draft.id)).toEqual(draft)
    expect(await storedTemplate(template.id)).toEqual(template)
  })

  test("refuses a step whose assigned group has been removed with precondition_failed, pointing at the step", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await publishedWithDraft(organization)
    const step = await insertTemplateStep(db, draft, { assigneeType: "team", assigneeTeamId: null })

    expectPreconditionFailed(await publish(template.id), [stepProblem("missing_assignee", step.id)])
    expect(await storedVersion(draft.id)).toEqual(draft)
  })

  test("refuses a dropdown field with no choices with precondition_failed, pointing at its step", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft, steps: [step] } = await publishedWithDraft(organization, ["Step"])
    const field = await insertTemplateField(db, step!, { type: "dropdown", options: noChoices })

    expectPreconditionFailed(await publish(template.id), [stepProblem("dropdown_without_choices", step!.id, field.id)])
    expect(await storedVersion(draft.id)).toEqual(draft)
  })

  test("lists every problem in one refusal", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await publishedWithDraft(organization)
    const unassigned = await insertTemplateStep(db, draft, { position: 0, assigneeType: "member", assigneeMemberId: null })
    const withDropdown = await insertTemplateStep(db, draft, { position: 1 })
    const firstDropdown = await insertTemplateField(db, withDropdown, { type: "dropdown", options: noChoices, position: 0 })
    const secondDropdown = await insertTemplateField(db, withDropdown, { type: "dropdown", options: noChoices, position: 1 })
    await insertTemplateStep(db, draft, { position: 2, title: "Fine" })

    expectPreconditionFailed(await publish(template.id), [
      stepProblem("missing_assignee", unassigned.id),
      stepProblem("dropdown_without_choices", withDropdown.id, firstDropdown.id),
      stepProblem("dropdown_without_choices", withDropdown.id, secondDropdown.id),
    ])
  })
})

describe("DELETE /api/templates/:templateId/draft", () => {
  const discard = (templateId: string) => api().delete(`/api/templates/${templateId}/draft`)

  test("removes the draft with its steps and fields", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, draft, steps: [step] } = await publishedWithDraft(organization, ["Draft step"])
    const field = await insertTemplateField(db, step!)

    const response = await discard(template.id)

    expectStatus(response, 204)
    expect(response.text).toBe("")
    expect((await versionsOf(template)).map(version => version.id)).toEqual([published.id])
    expect(await storedVersion(draft.id)).toBeUndefined()
    expect(await db.select().from(templateSteps).where(eq(templateSteps.templateVersionId, draft.id))).toEqual([])
    expect(await storedField(field.id)).toBeUndefined()
  })

  test("leaves the current version and its steps as they were", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithDraft(organization, ["Draft step"])

    expectStatus(await discard(template.id), 204)

    expect(await storedVersion(published.id)).toEqual(published)
    expect(await titlesOf(published)).toEqual(["Published"])
    expect((await storedTemplate(template.id)).currentVersionId).toBe(published.id)
  })

  test("refuses a version 1 draft that was never published with conflict and keeps it", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization, ["Step"])

    expectError(await discard(template.id), 409, "conflict")
    expect(await storedVersion(draft.id)).toEqual(draft)
    expect(await titlesOf(draft)).toEqual(["Step"])
  })

  test("refuses a template with no draft with conflict and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithSteps(organization, ["Published"])

    expectError(await discard(template.id), 409, "conflict")
    expect(await storedVersion(published.id)).toEqual(published)
    expect(await storedTemplate(template.id)).toEqual(template)
  })

  test("refuses a draft that's already been discarded with conflict", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await publishedWithDraft(organization)

    expectStatus(await discard(template.id), 204)
    expectError(await discard(template.id), 409, "conflict")
  })
})

describe("GET /api/templates/:templateId/versions", () => {
  const listVersions = (templateId: string) => api().get(`/api/templates/${templateId}/versions`)

  test("returns every version, newest first", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization)
    await insertTemplateVersion(db, template, 1, "archived")
    await insertTemplateVersion(db, template, 2, "published")
    await insertTemplateVersion(db, template, 3, "draft")

    const response = await listVersions(template.id)

    expectStatus(response, 200)
    const body = response.body as TemplateVersionDto[]
    expect(body.map(version => [version.version, version.status])).toEqual([[3, "draft"], [2, "published"], [1, "archived"]])
  })

  test("returns versions as DTOs, without the organization or steps", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithSteps(organization, ["Step"])

    const [version] = (await listVersions(template.id)).body as TemplateVersionDto[]

    expect(version).toMatchObject({ id: published.id, templateId: template.id, version: 1, status: "published" })
    expect(version!.publishedAt).toBe(published.publishedAt!.toISOString())
    expect(version).not.toHaveProperty("organizationId")
    expect(version).not.toHaveProperty("steps")
  })

  test("returns only this template's versions", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    await draftWithSteps(organization)

    const response = await listVersions(template.id)

    expect((response.body as TemplateVersionDto[]).map(version => version.id)).toEqual([draft.id])
  })

  test("returns an empty list for a template with no versions", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization)

    expect((await listVersions(template.id)).body).toEqual([])
  })
})

describe("GET /api/templates/:templateId/versions/:versionId", () => {
  const getVersion = (templateId: string, versionId: string) => api().get(`/api/templates/${templateId}/versions/${versionId}`)

  test("returns the version with its steps and their fields in position order", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithSteps(organization, [])
    const second = await insertTemplateStep(db, published, { title: "Second", position: 1 })
    const first = await insertTemplateStep(db, published, { title: "First", position: 0 })
    await insertTemplateField(db, first, { key: "later", position: 1 })
    await insertTemplateField(db, first, { key: "earlier", position: 0 })
    await insertTemplateField(db, second, { key: "other" })

    const response = await getVersion(template.id, published.id)

    expectStatus(response, 200)
    const body = response.body as VersionWithSteps
    expect(body).toMatchObject({ id: published.id, version: 1, status: "published" })
    expect(body).not.toHaveProperty("organizationId")
    expect(body.steps.map(step => step.title)).toEqual(["First", "Second"])
    expect(body.steps.map(step => step.fields.map(field => field.key))).toEqual([["earlier", "later"], ["other"]])
    expect(body.steps[0]).not.toHaveProperty("organizationId")
    expect(body.steps[0]!.fields[0]).not.toHaveProperty("organizationId")
  })

  test("returns an earlier version that isn't the current one", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization)
    const earlier = await insertTemplateVersion(db, template, 1, "archived")
    await insertTemplateStep(db, earlier, { title: "Old step" })
    await setCurrentVersion(db, template, await insertTemplateVersion(db, template, 2, "published"))

    const body = (await getVersion(template.id, earlier.id)).body as VersionWithSteps

    expect(body).toMatchObject({ id: earlier.id, status: "archived" })
    expect(body.steps.map(step => step.title)).toEqual(["Old step"])
  })

  test("returns the draft", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await publishedWithDraft(organization, ["Draft step"])

    const body = (await getVersion(template.id, draft.id)).body as VersionWithSteps

    expect(body).toMatchObject({ id: draft.id, status: "draft" })
    expect(body.steps.map(step => step.title)).toEqual(["Draft step"])
  })

  test("returns no assignee, marked missing, for a step whose assigned member has been removed", async () => {
    const { organization } = await signedInMember("owner")
    const { member: removed } = await createMember(db, organization, "editor")
    const { template, published } = await publishedWithSteps(organization, [])
    await insertTemplateStep(db, published, { assigneeType: "member", assigneeMemberId: removed.id })
    await db.delete(members).where(eq(members.id, removed.id))

    const body = (await getVersion(template.id, published.id)).body as VersionWithSteps

    expect(body.steps[0]).toMatchObject({ assignee: null, assigneeMissing: true })
  })

  test("refuses another template's version with not_found", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await publishedWithSteps(organization, ["Mine"])
    const { published: otherVersion } = await publishedWithSteps(organization, ["Other"])

    expectError(await getVersion(template.id, otherVersion.id), 404, "not_found")
  })

  test("refuses a version ID that doesn't exist with not_found", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await publishedWithSteps(organization, ["Step"])

    expectError(await getVersion(template.id, typeIdForTable("templateVersions").toString()), 404, "not_found")
  })

  test("refuses a version ID for another table with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await publishedWithSteps(organization, ["Step"])

    expectError(await getVersion(template.id, typeIdForTable("templateSteps").toString()), 400, "validation_failed")
  })
})

describe("POST /api/templates/:templateId/versions/:versionId/archive", () => {
  const archiveVersion = (templateId: string, versionId: string) => api().post(`/api/templates/${templateId}/versions/${versionId}/archive`)

  // A template with published versions 1 and 2, with version 2 current
  async function twoPublishedVersions() {
    const { organization } = await signedInMember("owner")
    const inserted = await insertTemplate(db, organization)
    const earlier = await insertTemplateVersion(db, inserted, 1, "published")
    const current = await insertTemplateVersion(db, inserted, 2, "published")
    const template = await setCurrentVersion(db, inserted, current)
    return { organization, template, earlier, current }
  }

  test("archives an earlier published version and returns it", async () => {
    const { template, earlier } = await twoPublishedVersions()

    const response = await archiveVersion(template.id, earlier.id)

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ id: earlier.id, status: "archived" })
    expect(response.body).not.toHaveProperty("organizationId")
    expect((await storedVersion(earlier.id))!.status).toBe("archived")
  })

  test("keeps the version's steps and fields", async () => {
    const { template, earlier } = await twoPublishedVersions()
    const step = await insertTemplateStep(db, earlier)
    const field = await insertTemplateField(db, step)

    expectStatus(await archiveVersion(template.id, earlier.id), 200)

    expect((await stepsOf(earlier)).map(row => row.id)).toEqual([step.id])
    expect(await storedField(field.id)).toEqual(field)
  })

  test("leaves the other versions as they were", async () => {
    const { template, earlier, current } = await twoPublishedVersions()

    expectStatus(await archiveVersion(template.id, earlier.id), 200)

    expect(await storedVersion(current.id)).toEqual(current)
  })

  test("archives the current version and leaves it current", async () => {
    const { template, current } = await twoPublishedVersions()

    expectStatus(await archiveVersion(template.id, current.id), 200)

    expect((await storedVersion(current.id))!.status).toBe("archived")
    expect((await storedTemplate(template.id)).currentVersionId).toBe(current.id)
  })

  test("refuses the draft with conflict and keeps it", async () => {
    const { organization } = await signedInMember("owner")
    const { template, draft } = await publishedWithDraft(organization, ["Step"])

    expectError(await archiveVersion(template.id, draft.id), 409, "conflict")
    expect(await storedVersion(draft.id)).toEqual(draft)
  })

  test("refuses a version that's already archived with conflict", async () => {
    const { organization } = await signedInMember("owner")
    const template = await insertTemplate(db, organization)
    const archived = await insertTemplateVersion(db, template, 1, "archived")
    await setCurrentVersion(db, template, await insertTemplateVersion(db, template, 2, "published"))

    expectError(await archiveVersion(template.id, archived.id), 409, "conflict")
    expect(await storedVersion(archived.id)).toEqual(archived)
  })

  test("refuses another template's version with not_found and changes nothing", async () => {
    const { organization, template } = await twoPublishedVersions()
    const { published: otherVersion } = await publishedWithSteps(organization, ["Other"])

    expectError(await archiveVersion(template.id, otherVersion.id), 404, "not_found")
    expect(await storedVersion(otherVersion.id)).toEqual(otherVersion)
  })

  test("refuses a version ID that doesn't exist with not_found", async () => {
    const { template } = await twoPublishedVersions()

    expectError(await archiveVersion(template.id, typeIdForTable("templateVersions").toString()), 404, "not_found")
  })

  test("refuses a version ID for another table with validation_failed", async () => {
    const { template } = await twoPublishedVersions()

    expectError(await archiveVersion(template.id, typeIdForTable("templateSteps").toString()), 400, "validation_failed")
  })
})
