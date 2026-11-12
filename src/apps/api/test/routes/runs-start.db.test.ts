import { eq } from "drizzle-orm"
import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import { templates, templateVersions } from "@/db/schema.ts"
import type { RunWithDetailsDto } from "@checklog/shared/api"
import { typeIdForTable } from "@checklog/shared/utils"
import {
  addToGroup,
  createGroup,
  createMember,
  createOrganization,
  grant,
  insertTemplate,
  insertTemplateStep,
  insertTemplateVersion,
  setCurrentVersion,
} from "@test/support/database.ts"
import { api, expectError, expectStatus } from "@test/support/http.ts"
import { expectPreconditionFailed, publishedTemplate, runsOf, stepsOfRun } from "@test/support/runs.ts"
import { signedInMember, stubSessions } from "@test/support/session.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates or runs.

stubSessions()

const startRun = (body: object, timezone: string | null = "Europe/London") => {
  const request = api().post("/api/runs")
  return (timezone === null ? request : request.set("X-Timezone", timezone)).send(body)
}

describe("POST /api/runs", () => {
  test("starts a run of the template's current version and returns it", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, version } = await publishedTemplate(organization, [{ title: "Check the boiler" }])

    const response = await startRun({ templateId: template.id })

    expectStatus(response, 200)
    const body = response.body as RunWithDetailsDto
    expect(body).toMatchObject({
      templateVersionId: version.id,
      scheduleId: null,
      name: template.name,
      timezone: "Europe/London",
      status: "in_progress",
      completedAt: null,
      createdBy: member.userId,
    })
    expect(body).not.toHaveProperty("organizationId")
    expect((await runsOf(template)).map(run => run.id)).toEqual([body.id])
  })

  test("uses the name it's given", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await publishedTemplate(organization, [{}])

    const response = await startRun({ templateId: template.id, name: "Monday checks" })

    expect(response.body).toMatchObject({ name: "Monday checks" })
  })

  test("takes the run's time zone from the X-Timezone header", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await publishedTemplate(organization, [{}])

    const response = await startRun({ templateId: template.id }, "America/New_York")

    expect(response.body).toMatchObject({ timezone: "America/New_York" })
  })

  test("creates one pending run step per template step, in template order", async () => {
    const { organization } = await signedInMember("owner")
    const { template, templateSteps } = await publishedTemplate(organization, [{ title: "First" }, { title: "Second" }, { title: "Third" }])

    const response = await startRun({ templateId: template.id })

    const body = response.body as RunWithDetailsDto
    expect(body.steps.map(step => step.templateStepId)).toEqual(templateSteps.map(step => step.id))
    expect(body.steps.map(step => step.templateStep.title)).toEqual(["First", "Second", "Third"])
    expect(body.steps.every(step => step.status === "pending" && step.runId === body.id)).toBe(true)
    const [run] = await runsOf(template)
    expect((await stepsOfRun(run!)).map(step => step.status)).toEqual(["pending", "pending", "pending"])
  })

  test("copies each step's assignee from the template", async () => {
    const { organization, member } = await signedInMember("owner")
    const teamId = await createGroup(db, organization)
    const { template } = await publishedTemplate(organization, [
      { assigneeType: "member", assigneeMemberId: member.id },
      { assigneeType: "team", assigneeTeamId: teamId },
      { assigneeType: "role", assigneeRole: "editor" },
      {},
    ])

    const response = await startRun({ templateId: template.id })

    const steps = (response.body as RunWithDetailsDto).steps
    expect(steps.map(step => step.assignee)).toEqual([
      { type: "member", memberId: member.id },
      { type: "team", teamId },
      { type: "role", role: "editor" },
      null,
    ])
    expect(steps.every(step => !step.assigneeMissing)).toBe(true)
  })

  test("sets each step's due date from the run's start and the step's due offset", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await publishedTemplate(organization, [{ dueOffset: "PT4H" }, { dueOffset: "P3D" }, {}])

    const response = await startRun({ templateId: template.id }, "UTC")

    const body = response.body as RunWithDetailsDto
    const started = new Date(body.createdAt).getTime()
    const hour = 60 * 60 * 1000
    expect(body.steps.map(step => (step.dueAt === null ? null : new Date(step.dueAt).getTime() - started))).toEqual([4 * hour, 72 * hour, null])
  })

  test("uses the current version, not a draft or an earlier version", async () => {
    const { organization } = await signedInMember("owner")
    const inserted = await insertTemplate(db, organization)
    const earlier = await insertTemplateVersion(db, inserted, 1, "published")
    await insertTemplateStep(db, earlier, { title: "Old" })
    const current = await insertTemplateVersion(db, inserted, 2, "published")
    await insertTemplateStep(db, current, { title: "Current" })
    const template = await setCurrentVersion(db, inserted, current)
    const draft = await insertTemplateVersion(db, template, 3, "draft")
    await insertTemplateStep(db, draft, { title: "Draft" })

    const response = await startRun({ templateId: template.id })

    const body = response.body as RunWithDetailsDto
    expect(body.templateVersionId).toBe(current.id)
    expect(body.steps.map(step => step.templateStep.title)).toEqual(["Current"])
  })

  test("returns the steps after a pending halt step as blocked", async () => {
    const { organization } = await signedInMember("owner")
    const { template } = await publishedTemplate(organization, [{}, { isHalt: true }, {}, {}])

    const response = await startRun({ templateId: template.id })

    expect((response.body as RunWithDetailsDto).steps.map(step => step.blocked)).toEqual([false, false, true, true])
  })

  test("returns each step's fields with no values and no notes", async () => {
    const { organization } = await signedInMember("owner")
    const { template, fields } = await publishedTemplate(organization, [{ fields: [{ key: "reading", type: "number", options: { type: "number" } }] }])

    const response = await startRun({ templateId: template.id })

    const [step] = (response.body as RunWithDetailsDto).steps
    expect(step!.fields).toMatchObject([{ id: fields[0]![0]!.id, key: "reading", value: null }])
    expect(step!.notes).toEqual([])
  })

  describe("access", () => {
    test.each(["owner", "admin"])("lets an %s start a run", async (role) => {
      const { organization } = await signedInMember(role)
      const { template } = await publishedTemplate(organization, [{}])

      expectStatus(await startRun({ templateId: template.id }), 200)
    })

    test("lets the member who created the template start a run", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { template } = await publishedTemplate(organization, [{}], { createdBy: member.userId })

      expectStatus(await startRun({ templateId: template.id }), 200)
    })

    test.each(["run", "edit"] as const)("lets a member with %s access start a run", async (level) => {
      const { organization, member } = await signedInMember("viewer")
      const { template } = await publishedTemplate(organization, [{}])
      await grant(db, template.id, { organization, memberId: member.id }, level)

      expectStatus(await startRun({ templateId: template.id }), 200)
    })

    test("lets a member whose group has run access start a run", async () => {
      const { organization, member } = await signedInMember("viewer")
      const teamId = await createGroup(db, organization)
      await addToGroup(db, teamId, member)
      const { template } = await publishedTemplate(organization, [{}])
      await grant(db, template.id, { organization, teamId }, "run")

      expectStatus(await startRun({ templateId: template.id }), 200)
    })

    test("refuses a member with only view access with forbidden and starts nothing", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { template } = await publishedTemplate(organization, [{}])
      await grant(db, template.id, { organization, memberId: member.id }, "view")

      expectError(await startRun({ templateId: template.id }), 403, "forbidden")
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses a member with only view access with forbidden, not precondition_failed, when the template is archived", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { template } = await publishedTemplate(organization, [{}])
      await db.update(templates).set({ status: "archived" }).where(eq(templates.id, template.id))
      await grant(db, template.id, { organization, memberId: member.id }, "view")

      expectError(await startRun({ templateId: template.id }), 403, "forbidden")
    })

    test("refuses a template the member can't see with not_found and starts nothing", async () => {
      const { organization } = await signedInMember("viewer")
      const { template } = await publishedTemplate(organization, [{}])

      expectError(await startRun({ templateId: template.id }), 404, "not_found")
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses another organization's template with not_found and starts nothing", async () => {
      const { template } = await publishedTemplate(await createOrganization(db), [{}])
      await signedInMember("owner")

      expectError(await startRun({ templateId: template.id }), 404, "not_found")
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses a template ID that doesn't exist with not_found", async () => {
      await signedInMember("owner")

      expectError(await startRun({ templateId: typeIdForTable("templates").toString() }), 404, "not_found")
    })

    test("refuses a signed-out request with unauthorized", async () => {
      const { template } = await publishedTemplate(await createOrganization(db), [{}])

      expectError(await startRun({ templateId: template.id }), 401, "unauthorized")
    })
  })

  describe("request validation", () => {
    test.each([
      ["no template ID", () => ({})],
      ["a template ID for another table", () => ({ templateId: typeIdForTable("runs").toString() })],
      ["an empty name", (templateId: string) => ({ templateId, name: "" })],
      ["an unknown setting", (templateId: string) => ({ templateId, scheduleId: typeIdForTable("schedules").toString() })],
    ])("refuses %s with validation_failed and starts nothing", async (_description, body) => {
      const { organization } = await signedInMember("owner")
      const { template } = await publishedTemplate(organization, [{}])

      expectError(await startRun(body(template.id)), 400, "validation_failed")
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses a request without an X-Timezone header with validation_failed and starts nothing", async () => {
      const { organization } = await signedInMember("owner")
      const { template } = await publishedTemplate(organization, [{}])

      expectError(await startRun({ templateId: template.id }, null), 400, "validation_failed")
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses an X-Timezone that isn't an IANA zone with validation_failed and starts nothing", async () => {
      const { organization } = await signedInMember("owner")
      const { template } = await publishedTemplate(organization, [{}])

      expectError(await startRun({ templateId: template.id }, "Mars/Olympus_Mons"), 400, "validation_failed")
      expect(await runsOf(template)).toEqual([])
    })
  })

  describe("start check", () => {
    test("refuses an archived template with precondition_failed, pointing at the template, and starts nothing", async () => {
      const { organization } = await signedInMember("owner")
      const { template } = await publishedTemplate(organization, [{}])
      await db.update(templates).set({ status: "archived" }).where(eq(templates.id, template.id))

      expectPreconditionFailed(await startRun({ templateId: template.id }), [template.id])
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses a template with no current version with precondition_failed, pointing at the template", async () => {
      const { organization } = await signedInMember("owner")
      const template = await insertTemplate(db, organization)
      const draft = await insertTemplateVersion(db, template, 1, "draft")
      await insertTemplateStep(db, draft)

      expectPreconditionFailed(await startRun({ templateId: template.id }), [template.id])
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses an archived current version with precondition_failed, pointing at the version", async () => {
      const { organization } = await signedInMember("owner")
      const { template, version } = await publishedTemplate(organization, [{}])
      await db.update(templateVersions).set({ status: "archived" }).where(eq(templateVersions.id, version.id))

      expectPreconditionFailed(await startRun({ templateId: template.id }), [version.id])
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses a step whose assigned member has been removed with precondition_failed, pointing at the step", async () => {
      const { organization } = await signedInMember("owner")
      const { template, templateSteps: [, missing] } = await publishedTemplate(organization, [{}, { assigneeType: "member", assigneeMemberId: null }])

      expectPreconditionFailed(await startRun({ templateId: template.id }), [missing!.id])
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses a step whose assigned group has been removed with precondition_failed, pointing at the step", async () => {
      const { organization } = await signedInMember("owner")
      const { template, templateSteps: [missing] } = await publishedTemplate(organization, [{ assigneeType: "team", assigneeTeamId: null }])

      expectPreconditionFailed(await startRun({ templateId: template.id }), [missing!.id])
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses a step assigned to a member of another organization with precondition_failed, pointing at the step", async () => {
      const { organization } = await signedInMember("owner")
      const { member: outsider } = await createMember(db, await createOrganization(db), "editor")
      const { template, templateSteps: [step] } = await publishedTemplate(organization, [{ assigneeType: "member", assigneeMemberId: outsider.id }])

      expectPreconditionFailed(await startRun({ templateId: template.id }), [step!.id])
      expect(await runsOf(template)).toEqual([])
    })

    test("refuses a step assigned to a group of another organization with precondition_failed, pointing at the step", async () => {
      const { organization } = await signedInMember("owner")
      const teamId = await createGroup(db, await createOrganization(db))
      const { template, templateSteps: [step] } = await publishedTemplate(organization, [{ assigneeType: "team", assigneeTeamId: teamId }])

      expectPreconditionFailed(await startRun({ templateId: template.id }), [step!.id])
      expect(await runsOf(template)).toEqual([])
    })

    test("lists every problem in one refusal", async () => {
      const { organization } = await signedInMember("owner")
      const { template, templateSteps: [first, , third] } = await publishedTemplate(organization, [
        { assigneeType: "member", assigneeMemberId: null },
        {},
        { assigneeType: "team", assigneeTeamId: null },
      ])

      expectPreconditionFailed(await startRun({ templateId: template.id }), [first!.id, third!.id])
    })

    test("starts a run with unassigned steps", async () => {
      const { organization } = await signedInMember("owner")
      const { template } = await publishedTemplate(organization, [{}, {}])

      expectStatus(await startRun({ templateId: template.id }), 200)
    })
  })
})
