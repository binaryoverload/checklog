import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import type { Paginated, RunDto, RunWithDetailsDto } from "@checklog/shared/api"
import {
  addToGroup,
  createGroup,
  createMember,
  createOrganization,
  expectCreationKept,
  grant,
} from "@test/support/database.ts"
import { api, expectError, expectStatus } from "@test/support/http.ts"
import {
  describeRunVisibility,
  insertFieldValue,
  insertNote,
  insertRun,
  insertRunStep,
  publishedTemplate,
  runWithSteps,
  stepsOfRun,
  storedRun,
} from "@test/support/runs.ts"
import { signedInMember, stubSessions } from "@test/support/session.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates or runs.

stubSessions()

const getRun = (runId: string) => api().get(`/api/runs/${runId}`)
const cancelRun = (runId: string) => api().post(`/api/runs/${runId}/cancel`)

describeRunVisibility([
  { name: "GET /api/runs/:runId", send: run => getRun(run.id) },
  { name: "POST /api/runs/:runId/cancel", send: run => cancelRun(run.id) },
])

describe("GET /api/runs/:runId", () => {
  test("returns the run with its steps in template order", async () => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [first, second, third] } = await publishedTemplate(organization, [{ title: "First" }, { title: "Second" }, { title: "Third" }])
    const run = await insertRun(version, { name: "Monday checks" })
    await insertRunStep(run, third!)
    await insertRunStep(run, first!)
    await insertRunStep(run, second!)

    const response = await getRun(run.id)

    expectStatus(response, 200)
    const body = response.body as RunWithDetailsDto
    expect(body).toMatchObject({ id: run.id, name: "Monday checks", status: "in_progress", timezone: "Europe/London" })
    expect(body).not.toHaveProperty("organizationId")
    expect(body.steps.map(step => step.templateStep.title)).toEqual(["First", "Second", "Third"])
    expect(body.steps[0]).not.toHaveProperty("organizationId")
  })

  test("returns each step's template step settings", async () => {
    const { organization } = await signedInMember("owner")
    const { run, templateSteps: [templateStep] } = await runWithSteps(organization, [{ title: "Sign off", kind: "task", isHalt: true }])

    const [step] = ((await getRun(run.id)).body as RunWithDetailsDto).steps

    expect(step!.templateStep).toMatchObject({ id: templateStep!.id, title: "Sign off", kind: "task", isHalt: true, skippable: false })
  })

  test("returns each step's fields in order with their values, and null for a field with no value", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step], fields } = await runWithSteps(organization, [{
      fields: [
        { key: "later", position: 1, type: "number", options: { type: "number" } },
        { key: "earlier", position: 0, type: "text", options: { type: "text", multiLine: false } },
      ],
    }])
    await insertFieldValue(step!, fields[0]![0]!, { type: "number", value: 21.5 })

    const [returned] = ((await getRun(run.id)).body as RunWithDetailsDto).steps

    expect(returned!.fields.map(field => [field.key, field.value])).toEqual([
      ["earlier", null],
      ["later", { type: "number", value: 21.5 }],
    ])
  })

  test("returns each step's notes oldest first", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step, other] } = await runWithSteps(organization, [{}, {}])
    await insertNote(step!, "First note")
    await insertNote(step!, "Second note")
    await insertNote(other!, "Elsewhere")

    const [returned] = ((await getRun(run.id)).body as RunWithDetailsDto).steps

    expect(returned!.notes.map(note => note.body)).toEqual(["First note", "Second note"])
    expect(returned!.notes[0]).not.toHaveProperty("organizationId")
  })

  test("marks the steps after a pending halt step as blocked", async () => {
    const { organization } = await signedInMember("owner")
    const { run } = await runWithSteps(organization, [{}, { isHalt: true }, {}, {}])

    const body = (await getRun(run.id)).body as RunWithDetailsDto

    expect(body.steps.map(step => step.blocked)).toEqual([false, false, true, true])
  })

  test("works out blocked steps in template order, whatever order the run steps were created in", async () => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [first, halt, after] } = await publishedTemplate(organization, [{}, { isHalt: true }, {}])
    const run = await insertRun(version)
    await insertRunStep(run, after!)
    await insertRunStep(run, halt!)
    await insertRunStep(run, first!)

    const body = (await getRun(run.id)).body as RunWithDetailsDto

    expect(body.steps.map(step => [step.templateStepId, step.blocked])).toEqual([
      [first!.id, false],
      [halt!.id, false],
      [after!.id, true],
    ])
  })

  test("doesn't block the steps after a completed halt step", async () => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [first, halt, after] } = await publishedTemplate(organization, [{}, { isHalt: true }, {}])
    const run = await insertRun(version)
    await insertRunStep(run, first!)
    await insertRunStep(run, halt!, { status: "completed", completedAt: new Date(), completedBy: "user_someone_else" })
    await insertRunStep(run, after!)

    const body = (await getRun(run.id)).body as RunWithDetailsDto

    expect(body.steps.map(step => step.blocked)).toEqual([false, false, false])
  })

  test("returns a step's assignee as stored on the run step, not the template step", async () => {
    const { organization, member } = await signedInMember("owner")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{ assigneeType: "role", assigneeRole: "editor" }])
    const run = await insertRun(version)
    await insertRunStep(run, templateStep!, { assigneeType: "member", assigneeMemberId: member.id, assigneeRole: null })

    const [step] = ((await getRun(run.id)).body as RunWithDetailsDto).steps

    expect(step).toMatchObject({ assignee: { type: "member", memberId: member.id }, assigneeMissing: false })
  })

  test("returns no assignee, marked missing, for a step whose assigned member has been removed", async () => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const run = await insertRun(version)
    await insertRunStep(run, templateStep!, { assigneeType: "member", assigneeMemberId: null })

    const [step] = ((await getRun(run.id)).body as RunWithDetailsDto).steps

    expect(step).toMatchObject({ assignee: null, assigneeMissing: true })
  })

  test("returns no assignee, not marked missing, for an unassigned step", async () => {
    const { organization } = await signedInMember("owner")
    const { run } = await runWithSteps(organization, [{}])

    const [step] = ((await getRun(run.id)).body as RunWithDetailsDto).steps

    expect(step).toMatchObject({ assignee: null, assigneeMissing: false })
  })

  describe("who can see it", () => {
    test.each(["owner", "admin"])("lets an %s see any run in the organization", async (role) => {
      const { organization } = await signedInMember(role)
      const { run } = await runWithSteps(organization, [{}])

      expectStatus(await getRun(run.id), 200)
    })

    test.each(["view", "run", "edit"] as const)("lets a member with %s access to the template see the run", async (level) => {
      const { organization, member } = await signedInMember("viewer")
      const { template, run } = await runWithSteps(organization, [{}])
      await grant(db, template.id, { organization, memberId: member.id }, level)

      expectStatus(await getRun(run.id), 200)
    })

    test("lets a member assigned one step see the whole run", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { version, templateSteps: [mine, theirs] } = await publishedTemplate(organization, [{}, {}])
      const run = await insertRun(version)
      await insertRunStep(run, mine!, { assigneeType: "member", assigneeMemberId: member.id })
      await insertRunStep(run, theirs!)

      const response = await getRun(run.id)

      expectStatus(response, 200)
      expect((response.body as RunWithDetailsDto).steps).toHaveLength(2)
    })

    test("lets a member of a group assigned a step see the run", async () => {
      const { organization, member } = await signedInMember("viewer")
      const teamId = await createGroup(db, organization, [member])
      const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
      const run = await insertRun(version)
      await insertRunStep(run, templateStep!, { assigneeType: "team", assigneeTeamId: teamId })

      expectStatus(await getRun(run.id), 200)
    })

    test("lets a member with the role assigned a step see the run", async () => {
      const { organization } = await signedInMember("editor")
      const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
      const run = await insertRun(version)
      await insertRunStep(run, templateStep!, { assigneeType: "role", assigneeRole: "editor" })

      expectStatus(await getRun(run.id), 200)
    })

    test("lets the member who started the run see it without template access or an assigned step", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
      const run = await insertRun(version, { createdBy: member.userId })
      await insertRunStep(run, templateStep!)

      expectStatus(await getRun(run.id), 200)
    })

    test("refuses a run someone else started, without template access or an assigned step, with not_found", async () => {
      const { organization } = await signedInMember("viewer")
      const { member: starter } = await createMember(db, organization, "viewer")
      const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
      const run = await insertRun(version, { createdBy: starter.userId })
      await insertRunStep(run, templateStep!)

      expectError(await getRun(run.id), 404, "not_found")
    })

    test("refuses a run whose steps are assigned only to someone else with not_found", async () => {
      const { organization } = await signedInMember("viewer")
      const { member: someoneElse } = await createMember(db, organization, "viewer")
      const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
      const run = await insertRun(version)
      await insertRunStep(run, templateStep!, { assigneeType: "member", assigneeMemberId: someoneElse.id })

      expectError(await getRun(run.id), 404, "not_found")
    })

    test("refuses a run assigned to a group the member isn't in with not_found", async () => {
      const { organization } = await signedInMember("viewer")
      const teamId = await createGroup(db, organization)
      const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
      const run = await insertRun(version)
      await insertRunStep(run, templateStep!, { assigneeType: "team", assigneeTeamId: teamId })

      expectError(await getRun(run.id), 404, "not_found")
    })
  })
})

describe("GET /api/runs", () => {
  const listRuns = (query: Record<string, string | number> = {}) => api().get("/api/runs").query(query)

  // Runs of one template the member can view, oldest first
  async function viewableRuns(organization: Parameters<typeof runWithSteps>[0], memberId: string, count: number) {
    const { template, version, templateSteps } = await publishedTemplate(organization, [{}])
    await grant(db, template.id, { organization, memberId }, "view")
    const created = []
    for (let index = 0; index < count; index++) {
      const run = await insertRun(version, { name: `Run ${index + 1}` })
      await insertRunStep(run, templateSteps[0]!)
      created.push(run)
    }
    return created
  }

  test("returns a page of the runs the member can see, newest first", async () => {
    const { organization, member } = await signedInMember("viewer")
    const [first, second, third] = await viewableRuns(organization, member.id, 3)

    const response = await listRuns()

    expectStatus(response, 200)
    const body = response.body as Paginated<RunDto>
    expect(body.items.map(run => run.id)).toEqual([third!.id, second!.id, first!.id])
    expect(body).toMatchObject({ nextCursor: null, total: 3 })
    expect(body.items[0]).not.toHaveProperty("organizationId")
  })

  test("includes runs the member started for scope=all, but not for scope=mine or scope=groups", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const started = await insertRun(version, { createdBy: member.userId })
    await insertRunStep(started, templateStep!)

    expect(((await listRuns()).body as Paginated<RunDto>).items.map(run => run.id)).toEqual([started.id])
    expect(((await listRuns({ scope: "mine" })).body as Paginated<RunDto>).items).toEqual([])
    expect(((await listRuns({ scope: "groups" })).body as Paginated<RunDto>).items).toEqual([])
  })

  test("returns only the admin's assigned runs for scope=mine, not every run in the organization", async () => {
    const { organization, member } = await signedInMember("admin")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const mine = await insertRun(version)
    await insertRunStep(mine, templateStep!, { assigneeType: "member", assigneeMemberId: member.id })
    const other = await insertRun(version)
    await insertRunStep(other, templateStep!)

    expect(((await listRuns({ scope: "mine" })).body as Paginated<RunDto>).items.map(run => run.id)).toEqual([mine.id])
    expect(((await listRuns()).body as Paginated<RunDto>).items.map(run => run.id).sort()).toEqual([mine.id, other.id].sort())
  })

  test("includes runs with a step assigned to the member, and leaves out runs they can't see", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const assigned = await insertRun(version)
    await insertRunStep(assigned, templateStep!, { assigneeType: "member", assigneeMemberId: member.id })
    const hidden = await insertRun(version)
    await insertRunStep(hidden, templateStep!)

    const body = (await listRuns()).body as Paginated<RunDto>

    expect(body.items.map(run => run.id)).toEqual([assigned.id])
  })

  test("leaves out other organizations' runs", async () => {
    await runWithSteps(await createOrganization(db), [{}])
    await signedInMember("owner")

    expect(((await listRuns()).body as Paginated<RunDto>).items).toEqual([])
  })

  test("returns only runs with a step assigned to the member for scope=mine", async () => {
    const { organization, member } = await signedInMember("viewer")
    const [viewable] = await viewableRuns(organization, member.id, 1)
    const teamId = await createGroup(db, organization, [member])
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const mine = await insertRun(version)
    await insertRunStep(mine, templateStep!, { assigneeType: "member", assigneeMemberId: member.id })
    const ourGroup = await insertRun(version)
    await insertRunStep(ourGroup, templateStep!, { assigneeType: "team", assigneeTeamId: teamId })

    const body = (await listRuns({ scope: "mine" })).body as Paginated<RunDto>

    expect(body.items.map(run => run.id)).toEqual([mine.id])
    expect(body.items.map(run => run.id)).not.toContain(viewable!.id)
  })

  test("returns runs with a step assigned to the member's groups or roles for scope=groups", async () => {
    const { organization, member } = await signedInMember("editor")
    const teamId = await createGroup(db, organization)
    await addToGroup(db, teamId, member)
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const group = await insertRun(version)
    await insertRunStep(group, templateStep!, { assigneeType: "team", assigneeTeamId: teamId })
    const role = await insertRun(version)
    await insertRunStep(role, templateStep!, { assigneeType: "role", assigneeRole: "editor" })
    const mine = await insertRun(version)
    await insertRunStep(mine, templateStep!, { assigneeType: "member", assigneeMemberId: member.id })

    const body = (await listRuns({ scope: "groups" })).body as Paginated<RunDto>

    expect(body.items.map(run => run.id).sort()).toEqual([group.id, role.id].sort())
  })

  test("returns every run the member can see for scope=all", async () => {
    const { organization, member } = await signedInMember("viewer")
    const [viewable] = await viewableRuns(organization, member.id, 1)
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const assigned = await insertRun(version)
    await insertRunStep(assigned, templateStep!, { assigneeType: "member", assigneeMemberId: member.id })

    const body = (await listRuns({ scope: "all" })).body as Paginated<RunDto>

    expect(body.items.map(run => run.id).sort()).toEqual([viewable!.id, assigned.id].sort())
  })

  test("filters by status when it's given, and returns every status when it isn't", async () => {
    const { organization } = await signedInMember("owner")
    const { version } = await publishedTemplate(organization, [{}])
    const inProgress = await insertRun(version)
    const completed = await insertRun(version, { status: "completed", completedAt: new Date() })
    const cancelled = await insertRun(version, { status: "cancelled" })

    expect(((await listRuns({ status: "completed" })).body as Paginated<RunDto>).items.map(run => run.id)).toEqual([completed.id])
    expect(((await listRuns()).body as Paginated<RunDto>).items.map(run => run.id).sort())
      .toEqual([inProgress.id, completed.id, cancelled.id].sort())
  })

  test("returns the next page from the cursor", async () => {
    const { organization, member } = await signedInMember("viewer")
    const [first, second, third] = await viewableRuns(organization, member.id, 3)

    const firstPage = (await listRuns({ limit: 2 })).body as Paginated<RunDto>
    const secondPage = (await listRuns({ limit: 2, cursor: firstPage.nextCursor! })).body as Paginated<RunDto>

    expect(firstPage.items.map(run => run.id)).toEqual([third!.id, second!.id])
    expect(firstPage.total).toBe(3)
    expect(secondPage.items.map(run => run.id)).toEqual([first!.id])
    expect(secondPage.nextCursor).toBeNull()
  })

  test.each([
    ["an unknown scope", { scope: "everyone" }],
    ["an unknown status", { status: "paused" }],
    ["a limit of 0", { limit: 0 }],
  ])("refuses %s with validation_failed", async (_description, query) => {
    await signedInMember("owner")

    expectError(await listRuns(query), 400, "validation_failed")
  })

  test("refuses a signed-out request with unauthorized", async () => {
    expectError(await listRuns(), 401, "unauthorized")
  })
})

describe("POST /api/runs/:runId/cancel", () => {
  test("cancels an in-progress run and returns it", async () => {
    const { organization } = await signedInMember("owner")
    const { run } = await runWithSteps(organization, [{}, {}])

    const response = await cancelRun(run.id)

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ id: run.id, status: "cancelled", completedAt: null })
    expect((response.body as RunWithDetailsDto).steps).toHaveLength(2)
    expect((await storedRun(run.id))!.status).toBe("cancelled")
  })

  test("leaves the run's steps as they were", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps } = await runWithSteps(organization, [{}, {}])

    expectStatus(await cancelRun(run.id), 200)

    expect(await stepsOfRun(run)).toEqual(runSteps)
  })

  test("keeps who started the run, and when", async () => {
    const { organization } = await signedInMember("owner")
    const { run } = await runWithSteps(organization, [{}])

    expectStatus(await cancelRun(run.id), 200)

    expectCreationKept(run, await storedRun(run.id))
  })

  test.each(["run", "edit"] as const)("lets a member with %s access to the template cancel the run", async (level) => {
    const { organization, member } = await signedInMember("viewer")
    const { template, run } = await runWithSteps(organization, [{}])
    await grant(db, template.id, { organization, memberId: member.id }, level)

    expectStatus(await cancelRun(run.id), 200)
  })

  test("refuses a member with only view access with forbidden and changes nothing", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { template, run } = await runWithSteps(organization, [{}])
    await grant(db, template.id, { organization, memberId: member.id }, "view")

    expectError(await cancelRun(run.id), 403, "forbidden")
    expect(await storedRun(run.id)).toEqual(run)
  })

  test("refuses a member who's only assigned a step with forbidden and changes nothing", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const run = await insertRun(version)
    await insertRunStep(run, templateStep!, { assigneeType: "member", assigneeMemberId: member.id })

    expectError(await cancelRun(run.id), 403, "forbidden")
    expect(await storedRun(run.id)).toEqual(run)
  })

  test.each([
    ["completed", { status: "completed" as const, completedAt: new Date() }],
    ["cancelled", { status: "cancelled" as const }],
  ])("refuses a %s run with conflict and changes nothing", async (_status, values) => {
    const { organization } = await signedInMember("owner")
    const { version } = await publishedTemplate(organization, [{}])
    const run = await insertRun(version, values)

    expectError(await cancelRun(run.id), 409, "conflict")
    expect(await storedRun(run.id)).toEqual(run)
  })

  test("refuses a member with only view access with forbidden, not conflict, when the run is completed", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { template, version } = await publishedTemplate(organization, [{}])
    await grant(db, template.id, { organization, memberId: member.id }, "view")
    const run = await insertRun(version, { status: "completed", completedAt: new Date() })

    expectError(await cancelRun(run.id), 403, "forbidden")
  })
})
