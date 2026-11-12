import type request from "supertest"
import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import type { Organization, Run, RunStep } from "@/util/types.ts"
import type { RunWithDetailsDto, StepNoteDto } from "@checklog/shared/api"
import type { FieldOptions } from "@checklog/shared/domain"
import { typeIdForTable } from "@checklog/shared/utils"
import { createGroup, createMember, createOrganization, expectCreationKept, grant } from "@test/support/database.ts"
import { api, expectError, expectStatus } from "@test/support/http.ts"
import {
  describeRunVisibility,
  expectPreconditionFailed,
  insertFieldValue,
  insertRun,
  insertRunStep,
  notesOf,
  publishedTemplate,
  runWithSteps,
  storedRun,
  storedRunStep,
  valuesOf,
} from "@test/support/runs.ts"
import type { StepSpec } from "@test/support/runs.ts"
import { signedInMember, stubSessions } from "@test/support/session.ts"
import { storedStep } from "@test/support/template-drafts.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates or runs.

stubSessions()

const stepPath = (run: { id: string }, step: { id: string }) => `/api/runs/${run.id}/steps/${step.id}`
const setValues = (run: { id: string }, step: { id: string }, values: object) =>
  api().put(`${stepPath(run, step)}/values`).set("X-Timezone", "Europe/London").send({ values })
const completeStep = (run: { id: string }, step: { id: string }) => api().post(`${stepPath(run, step)}/complete`)
const skipStep = (run: { id: string }, step: { id: string }, body: object = { reason: "Not needed today" }) =>
  api().post(`${stepPath(run, step)}/skip`).send(body)
const addNote = (run: { id: string }, step: { id: string }, body: object = { body: "Looks fine" }) =>
  api().post(`${stepPath(run, step)}/notes`).send(body)
const reassign = (run: { id: string }, step: { id: string }, assignee: object | null) =>
  api().patch(`${stepPath(run, step)}/assignee`).send({ assignee })

const textOptions: FieldOptions = { type: "text", multiLine: false }

describeRunVisibility([
  { name: "PUT /api/runs/:runId/steps/:stepId/values", send: (run, step) => setValues(run, step, {}) },
  { name: "POST /api/runs/:runId/steps/:stepId/complete", send: completeStep },
  { name: "POST /api/runs/:runId/steps/:stepId/skip", send: (run, step) => skipStep(run, step) },
  { name: "POST /api/runs/:runId/steps/:stepId/notes", send: (run, step) => addNote(run, step) },
  { name: "PATCH /api/runs/:runId/steps/:stepId/assignee", send: (run, step) => reassign(run, step, null) },
])

// A step action that only the step's assignees can take, or anyone with run access when it's unassigned
interface StepAction {
  name: string
  // The template step the action is taken on, set up so the action succeeds
  step: StepSpec
  send: (run: Run, step: RunStep) => PromiseLike<request.Response>
}

// A run of one step for the action, with the step assigned as given
async function runForAction(organization: Organization, action: StepAction, assignee: Partial<RunStep> = {}) {
  const { template, version, templateSteps: [templateStep], fields } = await publishedTemplate(organization, [action.step])
  const run = await insertRun(version)
  const step = await insertRunStep(run, templateStep!, assignee)
  return { template, run, step, fields: fields[0]! }
}

function describeStepActors(actions: StepAction[]): void {
  for (const action of actions) describe(`${action.name} who can act`, () => {
    test("lets the member the step is assigned to take it", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { run, step } = await runForAction(organization, action, { assigneeType: "member", assigneeMemberId: member.id })

      expectStatus(await action.send(run, step), 200)
    })

    test("lets a member of the group the step is assigned to take it", async () => {
      const { organization, member } = await signedInMember("viewer")
      const teamId = await createGroup(db, organization, [member])
      const { run, step } = await runForAction(organization, action, { assigneeType: "team", assigneeTeamId: teamId })

      expectStatus(await action.send(run, step), 200)
    })

    test("lets a member with the role the step is assigned to take it", async () => {
      const { organization } = await signedInMember("editor")
      const { run, step } = await runForAction(organization, action, { assigneeType: "role", assigneeRole: "editor" })

      expectStatus(await action.send(run, step), 200)
    })

    test.each(["run", "edit"] as const)("lets a member with %s access take an unassigned step", async (level) => {
      const { organization, member } = await signedInMember("viewer")
      const { template, run, step } = await runForAction(organization, action)
      await grant(db, template.id, { organization, memberId: member.id }, level)

      expectStatus(await action.send(run, step), 200)
    })

    test("refuses a member with only view access on an unassigned step with forbidden and changes nothing", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { template, run, step } = await runForAction(organization, action)
      await grant(db, template.id, { organization, memberId: member.id }, "view")

      expectError(await action.send(run, step), 403, "forbidden")
      expect(await storedRunStep(step.id)).toEqual(step)
    })

    test("refuses a member with edit access on a step assigned to someone else with forbidden and changes nothing", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { member: someoneElse } = await createMember(db, organization, "viewer")
      const { template, run, step } = await runForAction(organization, action, { assigneeType: "member", assigneeMemberId: someoneElse.id })
      await grant(db, template.id, { organization, memberId: member.id }, "edit")

      expectError(await action.send(run, step), 403, "forbidden")
      expect(await storedRunStep(step.id)).toEqual(step)
    })

    test("refuses a member with a role other than the one assigned with forbidden", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { template, run, step } = await runForAction(organization, action, { assigneeType: "role", assigneeRole: "editor" })
      await grant(db, template.id, { organization, memberId: member.id }, "view")

      expectError(await action.send(run, step), 403, "forbidden")
    })

    test.each([
      ["completed", { status: "completed" as const, completedAt: new Date() }],
      ["cancelled", { status: "cancelled" as const }],
    ])("refuses the assignee with conflict when the run is %s and changes nothing", async (_status, values) => {
      const { organization, member } = await signedInMember("viewer")
      const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [action.step])
      const run = await insertRun(version, values)
      const step = await insertRunStep(run, templateStep!, { assigneeType: "member", assigneeMemberId: member.id })

      expectError(await action.send(run, step), 409, "conflict")
      expect(await storedRunStep(step.id)).toEqual(step)
    })

    test("refuses a member with only view access with forbidden, not conflict, when the run is completed", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { template, version, templateSteps: [templateStep] } = await publishedTemplate(organization, [action.step])
      await grant(db, template.id, { organization, memberId: member.id }, "view")
      const run = await insertRun(version, { status: "completed", completedAt: new Date() })
      const step = await insertRunStep(run, templateStep!)

      expectError(await action.send(run, step), 403, "forbidden")
    })

    test("refuses a step from another run with not_found and changes nothing", async () => {
      const { organization } = await signedInMember("owner")
      const { run } = await runForAction(organization, action)
      const { step: otherStep } = await runForAction(organization, action)

      expectError(await action.send(run, otherStep), 404, "not_found")
      expect(await storedRunStep(otherStep.id)).toEqual(otherStep)
    })

    test("refuses a step ID that doesn't exist with not_found", async () => {
      const { organization } = await signedInMember("owner")
      const { run } = await runForAction(organization, action)

      expectError(await action.send(run, { id: typeIdForTable("runSteps").toString() } as RunStep), 404, "not_found")
    })

    test("refuses a step ID for another table with validation_failed", async () => {
      const { organization } = await signedInMember("owner")
      const { run } = await runForAction(organization, action)

      expectError(await action.send(run, { id: typeIdForTable("templateSteps").toString() } as RunStep), 400, "validation_failed")
    })
  })
}

describeStepActors([
  {
    name: "PUT /api/runs/:runId/steps/:stepId/values",
    step: { fields: [{ key: "notes_text", type: "text", options: textOptions }] },
    send: (run, step) => setValues(run, step, { notes_text: { type: "text", value: "All clear" } }),
  },
  {
    name: "POST /api/runs/:runId/steps/:stepId/complete",
    step: {},
    send: completeStep,
  },
  {
    name: "POST /api/runs/:runId/steps/:stepId/skip",
    step: { skippable: true },
    send: (run, step) => skipStep(run, step),
  },
])

describe("PUT /api/runs/:runId/steps/:stepId/values", () => {
  // A run of one unassigned step holding these fields, which an owner can act on
  async function stepWithFields(fields: StepSpec["fields"]) {
    const { organization, member } = await signedInMember("owner")
    const { run, runSteps: [step], fields: [stepFields] } = await runWithSteps(organization, [{ fields }])
    return { organization, member, run, step: step!, fields: stepFields! }
  }

  test("sets a field's value by its key and returns the run", async () => {
    const { member, run, step, fields: [field] } = await stepWithFields([{ key: "reading", type: "number", options: { type: "number" } }])

    const response = await setValues(run, step, { reading: { type: "number", value: 21.5 } })

    expectStatus(response, 200)
    const body = response.body as RunWithDetailsDto
    expect(body.id).toBe(run.id)
    expect(body.steps[0]!.fields).toMatchObject([{ key: "reading", value: { type: "number", value: 21.5 } }])
    expect(await valuesOf(step)).toMatchObject([{ templateFieldId: field!.id, value: { type: "number", value: 21.5 }, updatedBy: member.userId }])
  })

  test("sets several values at once", async () => {
    const { run, step } = await stepWithFields([
      { key: "reading", type: "number", options: { type: "number" } },
      { key: "checked", position: 1, type: "checkbox", options: { type: "checkbox" } },
    ])

    expectStatus(await setValues(run, step, { reading: { type: "number", value: 3 }, checked: { type: "checkbox", value: true } }), 200)

    expect((await valuesOf(step)).map(row => row.value)).toEqual(expect.arrayContaining([
      { type: "number", value: 3 },
      { type: "checkbox", value: true },
    ]))
  })

  test("changes only the values it's given", async () => {
    const { run, step, fields: [reading, comment] } = await stepWithFields([
      { key: "reading", type: "number", options: { type: "number" } },
      { key: "comment", position: 1, type: "text", options: textOptions },
    ])
    await insertFieldValue(step, comment!, { type: "text", value: "Keep me" })

    expectStatus(await setValues(run, step, { reading: { type: "number", value: 7 } }), 200)

    const rows = await valuesOf(step)
    expect(rows.find(row => row.templateFieldId === comment!.id)!.value).toEqual({ type: "text", value: "Keep me" })
    expect(rows.find(row => row.templateFieldId === reading!.id)!.value).toEqual({ type: "number", value: 7 })
  })

  test("replaces an existing value, keeping one value per field and who first set it", async () => {
    const { member, run, step, fields: [field] } = await stepWithFields([{ key: "reading", type: "number", options: { type: "number" } }])
    const existing = await insertFieldValue(step, field!, { type: "number", value: 1 })

    expectStatus(await setValues(run, step, { reading: { type: "number", value: 2 } }), 200)

    const rows = await valuesOf(step)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: existing.id, value: { type: "number", value: 2 }, updatedBy: member.userId })
    expectCreationKept(existing, rows[0])
  })

  test("clears a value set to null", async () => {
    const { run, step, fields: [field] } = await stepWithFields([{ key: "comment", type: "text", options: textOptions }])
    await insertFieldValue(step, field!, { type: "text", value: "Remove me" })

    const response = await setValues(run, step, { comment: null })

    expectStatus(response, 200)
    expect((response.body as RunWithDetailsDto).steps[0]!.fields).toMatchObject([{ key: "comment", value: null }])
    expect((await valuesOf(step)).every(row => row.value === null)).toBe(true)
  })

  test("keeps who started the run and created the step, and when", async () => {
    const { run, step } = await stepWithFields([{ key: "comment", type: "text", options: textOptions }])

    expectStatus(await setValues(run, step, { comment: { type: "text", value: "Fine" } }), 200)

    expectCreationKept(run, await storedRun(run.id))
    expectCreationKept(step, await storedRunStep(step.id))
  })

  test.each<[string, FieldOptions, object]>([
    ["a dropdown choice", { type: "dropdown", choices: [{ value: "pass", label: "Pass" }], multiple: false }, { type: "dropdown", values: ["pass"] }],
    ["several dropdown choices when multiple is allowed", { type: "dropdown", choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }], multiple: true }, { type: "dropdown", values: ["a", "b"] }],
    ["a number within its limits", { type: "number", min: 0, max: 10 }, { type: "number", value: 10 }],
    ["text within its length and pattern", { type: "text", multiLine: false, minLength: 2, maxLength: 5, pattern: "^[A-Z]+$" }, { type: "text", value: "ABC" }],
    ["a past date when future dates aren't allowed", { type: "date", dateType: "date", allowFuture: false }, { type: "date", dateType: "date", value: "2020-01-01" }],
    ["a future date when future dates are allowed", { type: "date", dateType: "date", allowFuture: true }, { type: "date", dateType: "date", value: "2099-01-01" }],
  ])("accepts %s", async (_description, options, value) => {
    const { run, step } = await stepWithFields([{ key: "field", type: options.type, options }])

    expectStatus(await setValues(run, step, { field: value }), 200)
  })

  test.each<[string, FieldOptions, object]>([
    ["a value of the wrong type", { type: "number" }, { type: "text", value: "four" }],
    ["a dropdown value that isn't one of its choices", { type: "dropdown", choices: [{ value: "pass", label: "Pass" }], multiple: false }, { type: "dropdown", values: ["maybe"] }],
    ["several dropdown choices when only one is allowed", { type: "dropdown", choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }], multiple: false }, { type: "dropdown", values: ["a", "b"] }],
    ["a number above its maximum", { type: "number", max: 10 }, { type: "number", value: 11 }],
    ["a number below its minimum", { type: "number", min: 0 }, { type: "number", value: -1 }],
    ["text longer than its maximum length", { type: "text", multiLine: false, maxLength: 3 }, { type: "text", value: "Four" }],
    ["text shorter than its minimum length", { type: "text", multiLine: false, minLength: 3 }, { type: "text", value: "No" }],
    ["text that doesn't match its pattern", { type: "text", multiLine: false, pattern: "^[0-9]+$" }, { type: "text", value: "abc" }],
    ["a future date when future dates aren't allowed", { type: "date", dateType: "date", allowFuture: false }, { type: "date", dateType: "date", value: "2099-01-01" }],
  ])("refuses %s with validation_failed and stores nothing", async (_description, options, value) => {
    const { run, step } = await stepWithFields([{ key: "field", type: options.type, options }])

    expectError(await setValues(run, step, { field: value }), 400, "validation_failed")
    expect(await valuesOf(step)).toEqual([])
  })

  test("refuses a key the step has no field for with validation_failed and stores nothing", async () => {
    const { run, step } = await stepWithFields([{ key: "reading", type: "number", options: { type: "number" } }])

    expectError(await setValues(run, step, { missing: { type: "number", value: 1 } }), 400, "validation_failed")
    expect(await valuesOf(step)).toEqual([])
  })

  test("refuses the key of a field on another step with validation_failed and stores nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step, other] } = await runWithSteps(organization, [{}, { fields: [{ key: "elsewhere", type: "text", options: textOptions }] }])

    expectError(await setValues(run, step!, { elsewhere: { type: "text", value: "No" } }), 400, "validation_failed")
    expect(await valuesOf(other!)).toEqual([])
  })

  test("stores none of the values when one of them is invalid", async () => {
    const { run, step } = await stepWithFields([
      { key: "reading", type: "number", options: { type: "number" } },
      { key: "limited", position: 1, type: "number", options: { type: "number", max: 1 } },
    ])

    expectError(await setValues(run, step, { reading: { type: "number", value: 5 }, limited: { type: "number", value: 5 } }), 400, "validation_failed")
    expect(await valuesOf(step)).toEqual([])
  })

  test.each([
    ["no values", undefined],
    ["values that aren't an object", ["reading"]],
  ])("refuses %s with validation_failed", async (_description, values) => {
    const { run, step } = await stepWithFields([{ key: "reading", type: "number", options: { type: "number" } }])

    expectError(await api().put(`${stepPath(run, step)}/values`).set("X-Timezone", "Europe/London").send({ values }), 400, "validation_failed")
  })

  test.each([
    ["completed", { status: "completed" as const, completedAt: new Date(), completedBy: "user_someone_else" }],
    ["skipped", { status: "skipped" as const, completedAt: new Date(), completedBy: "user_someone_else", skipReason: "Not needed" }],
  ])("refuses a %s step with conflict and stores nothing", async (_status, values) => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{ skippable: true, fields: [{ key: "comment", type: "text", options: textOptions }] }])
    const run = await insertRun(version)
    const step = await insertRunStep(run, templateStep!, values)

    expectError(await setValues(run, step, { comment: { type: "text", value: "Too late" } }), 409, "conflict")
    expect(await valuesOf(step)).toEqual([])
  })
})

describe("POST /api/runs/:runId/steps/:stepId/complete", () => {
  test("completes the step, records who completed it and when, and returns the run", async () => {
    const { organization, member } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}, {}])
    const before = Date.now()

    const response = await completeStep(run, step!)

    expectStatus(response, 200)
    expect((response.body as RunWithDetailsDto).steps[0]).toMatchObject({ id: step!.id, status: "completed", completedBy: member.userId })
    const stored = (await storedRunStep(step!.id))!
    expect(stored).toMatchObject({ status: "completed", completedBy: member.userId, skipReason: null })
    expect(stored.completedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  test("leaves the run in progress while other steps are pending", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}, {}])

    const response = await completeStep(run, step!)

    expect(response.body).toMatchObject({ status: "in_progress", completedAt: null })
    expect((await storedRun(run.id))!.status).toBe("in_progress")
  })

  test("completes the run when the last step is resolved", async () => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [first, second, third] } = await publishedTemplate(organization, [{}, { skippable: true }, {}])
    const run = await insertRun(version)
    await insertRunStep(run, first!, { status: "completed", completedAt: new Date(), completedBy: "user_someone_else" })
    await insertRunStep(run, second!, { status: "skipped", completedAt: new Date(), completedBy: "user_someone_else", skipReason: "Not needed" })
    const last = await insertRunStep(run, third!)

    const response = await completeStep(run, last)

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ status: "completed" })
    const stored = (await storedRun(run.id))!
    expect(stored.status).toBe("completed")
    expect(stored.completedAt).not.toBeNull()
  })

  test("completes a step whose required fields all have values", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step], fields: [stepFields] } = await runWithSteps(organization, [{ fields: [{ key: "reading", required: true, type: "number", options: { type: "number" } }] }])
    const [required] = stepFields!
    await insertFieldValue(step!, required!, { type: "number", value: 4 })

    expectStatus(await completeStep(run, step!), 200)
  })

  test("completes a step whose optional fields are empty", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{ fields: [{ key: "comment", required: false, type: "text", options: textOptions }] }])

    expectStatus(await completeStep(run, step!), 200)
  })

  test("refuses a step with a required field that has no value with precondition_failed, pointing at the field", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step], fields: [stepFields] } = await runWithSteps(organization, [{
      fields: [
        { key: "first_reading", required: true, type: "number", options: { type: "number" } },
        { key: "second_reading", position: 1, required: true, type: "number", options: { type: "number" } },
      ],
    }])
    const [missing, filled] = stepFields!
    await insertFieldValue(step!, filled!, { type: "number", value: 1 })

    expectPreconditionFailed(await completeStep(run, step!), [missing!.id])
    expect(await storedRunStep(step!.id)).toEqual(step)
  })

  test("refuses a step with a required field whose value was cleared with precondition_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step], fields: [stepFields] } = await runWithSteps(organization, [{ fields: [{ key: "reading", required: true, type: "number", options: { type: "number" } }] }])
    const [field] = stepFields!
    await insertFieldValue(step!, field!, null)

    expectPreconditionFailed(await completeStep(run, step!), [field!.id])
    expect(await storedRunStep(step!.id)).toEqual(step)
  })

  test("lists every missing required field in one refusal", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step], fields: [stepFields] } = await runWithSteps(organization, [{
      fields: [
        { key: "first_reading", required: true, type: "number", options: { type: "number" } },
        { key: "second_reading", position: 1, required: true, type: "number", options: { type: "number" } },
      ],
    }])
    const [first, second] = stepFields!

    expectPreconditionFailed(await completeStep(run, step!), [first!.id, second!.id])
  })

  test("refuses a step after a pending halt step with precondition_failed, pointing at the halt step", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [halt, after], templateSteps: [haltTemplateStep] } = await runWithSteps(organization, [{ isHalt: true }, {}])

    expectPreconditionFailed(await completeStep(run, after!), [[halt!.id, haltTemplateStep!.id]])
    expect(await storedRunStep(after!.id)).toEqual(after)
  })

  test("completes a pending halt step itself", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [halt] } = await runWithSteps(organization, [{ isHalt: true }, {}])

    expectStatus(await completeStep(run, halt!), 200)
  })

  test("completes a step before a pending halt step", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [before] } = await runWithSteps(organization, [{}, { isHalt: true }])

    expectStatus(await completeStep(run, before!), 200)
  })

  test("refuses an approval step with conflict and changes nothing", async () => {
    const { organization, member } = await signedInMember("owner")
    const { version, templateSteps: [approval] } = await publishedTemplate(organization, [{ kind: "approval", assigneeType: "member", assigneeMemberId: member.id }])
    const run = await insertRun(version)
    const step = await insertRunStep(run, approval!)

    expectError(await completeStep(run, step), 409, "conflict")
    expect(await storedRunStep(step.id)).toEqual(step)
  })

  test.each([
    ["completed", { status: "completed" as const, completedAt: new Date(), completedBy: "user_someone_else" }],
    ["skipped", { status: "skipped" as const, completedAt: new Date(), completedBy: "user_someone_else", skipReason: "Not needed" }],
  ])("refuses a %s step with conflict and changes nothing", async (_status, values) => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{ skippable: true }, {}])
    const run = await insertRun(version)
    const step = await insertRunStep(run, templateStep!, values)

    expectError(await completeStep(run, step), 409, "conflict")
    expect(await storedRunStep(step.id)).toEqual(step)
  })

  test("keeps who started the run and created the step, and when", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    expectStatus(await completeStep(run, step!), 200)

    expectCreationKept(run, await storedRun(run.id))
    expectCreationKept(step!, await storedRunStep(step!.id))
  })
})

describe("POST /api/runs/:runId/steps/:stepId/skip", () => {
  test("skips a skippable step with its reason, records who skipped it and when, and returns the run", async () => {
    const { organization, member } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{ skippable: true }, {}])

    const response = await skipStep(run, step!, { reason: "Boiler replaced last week" })

    expectStatus(response, 200)
    expect((response.body as RunWithDetailsDto).steps[0]).toMatchObject({ status: "skipped", skipReason: "Boiler replaced last week", completedBy: member.userId })
    const stored = (await storedRunStep(step!.id))!
    expect(stored).toMatchObject({ status: "skipped", skipReason: "Boiler replaced last week", completedBy: member.userId })
    expect(stored.completedAt).not.toBeNull()
  })

  test("skips a step with required fields left empty", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{ skippable: true, fields: [{ key: "reading", required: true, type: "number", options: { type: "number" } }] }])

    expectStatus(await skipStep(run, step!), 200)
  })

  test("completes the run when the last step is skipped", async () => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [first, second] } = await publishedTemplate(organization, [{}, { skippable: true }])
    const run = await insertRun(version)
    await insertRunStep(run, first!, { status: "completed", completedAt: new Date(), completedBy: "user_someone_else" })
    const last = await insertRunStep(run, second!)

    const response = await skipStep(run, last)

    expect(response.body).toMatchObject({ status: "completed" })
    expect((await storedRun(run.id))!.status).toBe("completed")
  })

  test("refuses a step that isn't skippable with conflict and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{ skippable: false }])

    expectError(await skipStep(run, step!), 409, "conflict")
    expect(await storedRunStep(step!.id)).toEqual(step)
  })

  test.each([
    ["no reason", {}],
    ["an empty reason", { reason: "" }],
  ])("refuses %s with validation_failed and changes nothing", async (_description, body) => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{ skippable: true }])

    expectError(await skipStep(run, step!, body), 400, "validation_failed")
    expect(await storedRunStep(step!.id)).toEqual(step)
  })

  test.each([
    ["completed", { status: "completed" as const, completedAt: new Date(), completedBy: "user_someone_else" }],
    ["skipped", { status: "skipped" as const, completedAt: new Date(), completedBy: "user_someone_else", skipReason: "Not needed" }],
  ])("refuses a %s step with conflict and changes nothing", async (_status, values) => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{ skippable: true }, {}])
    const run = await insertRun(version)
    const step = await insertRunStep(run, templateStep!, values)

    expectError(await skipStep(run, step), 409, "conflict")
    expect(await storedRunStep(step.id)).toEqual(step)
  })

  test("keeps who started the run and created the step, and when", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{ skippable: true }])

    expectStatus(await skipStep(run, step!), 200)

    expectCreationKept(run, await storedRun(run.id))
    expectCreationKept(step!, await storedRunStep(step!.id))
  })
})

describe("POST /api/runs/:runId/steps/:stepId/notes", () => {
  test("adds a note to the step and returns it", async () => {
    const { organization, member } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    const response = await addNote(run, step!, { body: "Pressure was a little low" })

    expectStatus(response, 200)
    const body = response.body as StepNoteDto
    expect(body).toMatchObject({ runStepId: step!.id, body: "Pressure was a little low", createdBy: member.userId })
    expect(body).not.toHaveProperty("organizationId")
    expect((await notesOf(step!)).map(note => note.body)).toEqual(["Pressure was a little low"])
  })

  test("adds each note after the ones before it", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    expectStatus(await addNote(run, step!, { body: "First" }), 200)
    expectStatus(await addNote(run, step!, { body: "Correction" }), 200)

    expect((await notesOf(step!)).map(note => note.body)).toEqual(["First", "Correction"])
  })

  test("lets any member who can see the run add a note, including with only view access", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { template, run, runSteps: [step] } = await runWithSteps(organization, [{}])
    await grant(db, template.id, { organization, memberId: member.id }, "view")

    expectStatus(await addNote(run, step!), 200)
  })

  test("lets a member assigned another step of the run add a note", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { version, templateSteps: [mine, theirs] } = await publishedTemplate(organization, [{}, {}])
    const run = await insertRun(version)
    await insertRunStep(run, mine!, { assigneeType: "member", assigneeMemberId: member.id })
    const other = await insertRunStep(run, theirs!)

    expectStatus(await addNote(run, other), 200)
  })

  test.each([
    ["no body", {}],
    ["an empty body", { body: "" }],
  ])("refuses %s with validation_failed and adds nothing", async (_description, body) => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    expectError(await addNote(run, step!, body), 400, "validation_failed")
    expect(await notesOf(step!)).toEqual([])
  })

  test("refuses a step from another run with not_found and adds nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { run } = await runWithSteps(organization, [{}])
    const { runSteps: [otherStep] } = await runWithSteps(organization, [{}])

    expectError(await addNote(run, otherStep!), 404, "not_found")
    expect(await notesOf(otherStep!)).toEqual([])
  })
})

describe("PATCH /api/runs/:runId/steps/:stepId/assignee", () => {
  test("assigns the step to a member and returns the run", async () => {
    const { organization } = await signedInMember("owner")
    const { member: assignee } = await createMember(db, organization, "viewer")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    const response = await reassign(run, step!, { type: "member", memberId: assignee.id })

    expectStatus(response, 200)
    expect((response.body as RunWithDetailsDto).steps[0]).toMatchObject({
      assignee: { type: "member", memberId: assignee.id },
      assigneeMissing: false,
    })
    expect(await storedRunStep(step!.id)).toMatchObject({ assigneeType: "member", assigneeMemberId: assignee.id, assigneeTeamId: null, assigneeRole: null })
  })

  test("assigns the step to a group, clearing the member", async () => {
    const { organization, member } = await signedInMember("owner")
    const teamId = await createGroup(db, organization)
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const run = await insertRun(version)
    const step = await insertRunStep(run, templateStep!, { assigneeType: "member", assigneeMemberId: member.id })

    expectStatus(await reassign(run, step, { type: "team", teamId }), 200)

    expect(await storedRunStep(step.id)).toMatchObject({ assigneeType: "team", assigneeTeamId: teamId, assigneeMemberId: null, assigneeRole: null })
  })

  test("assigns the step to a role", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    expectStatus(await reassign(run, step!, { type: "role", role: "editor" }), 200)

    expect(await storedRunStep(step!.id)).toMatchObject({ assigneeType: "role", assigneeRole: "editor" })
  })

  test("unassigns the step when the assignee is null", async () => {
    const { organization, member } = await signedInMember("owner")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const run = await insertRun(version)
    const step = await insertRunStep(run, templateStep!, { assigneeType: "member", assigneeMemberId: member.id })

    expectStatus(await reassign(run, step, null), 200)

    expect(await storedRunStep(step.id)).toMatchObject({ assigneeType: null, assigneeMemberId: null, assigneeTeamId: null, assigneeRole: null })
  })

  test("reassigns a step whose assigned member has been removed", async () => {
    const { organization, member } = await signedInMember("owner")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const run = await insertRun(version)
    const step = await insertRunStep(run, templateStep!, { assigneeType: "member", assigneeMemberId: null })

    expectStatus(await reassign(run, step, { type: "member", memberId: member.id }), 200)

    expect(await storedRunStep(step.id)).toMatchObject({ assigneeType: "member", assigneeMemberId: member.id })
  })

  test("leaves the template step's assignee as it was", async () => {
    const { organization } = await signedInMember("owner")
    const { member: assignee } = await createMember(db, organization, "viewer")
    const { run, runSteps: [step], templateSteps: [templateStep] } = await runWithSteps(organization, [{}])

    expectStatus(await reassign(run, step!, { type: "member", memberId: assignee.id }), 200)

    expect(await storedStep(templateStep!.id)).toEqual(templateStep)
  })

  test("keeps who started the run and created the step, and when", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    expectStatus(await reassign(run, step!, { type: "role", role: "editor" }), 200)

    expectCreationKept(run, await storedRun(run.id))
    expectCreationKept(step!, await storedRunStep(step!.id))
  })

  test.each(["run", "edit"] as const)("lets a member with %s access reassign a step", async (level) => {
    const { organization, member } = await signedInMember("viewer")
    const { template, run, runSteps: [step] } = await runWithSteps(organization, [{}])
    await grant(db, template.id, { organization, memberId: member.id }, level)

    expectStatus(await reassign(run, step!, { type: "role", role: "editor" }), 200)
  })

  test("refuses a member with only view access with forbidden and changes nothing", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { template, run, runSteps: [step] } = await runWithSteps(organization, [{}])
    await grant(db, template.id, { organization, memberId: member.id }, "view")

    expectError(await reassign(run, step!, { type: "role", role: "editor" }), 403, "forbidden")
    expect(await storedRunStep(step!.id)).toEqual(step)
  })

  test("refuses the step's own assignee without run access with forbidden and changes nothing", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const run = await insertRun(version)
    const step = await insertRunStep(run, templateStep!, { assigneeType: "member", assigneeMemberId: member.id })

    expectError(await reassign(run, step, null), 403, "forbidden")
    expect(await storedRunStep(step.id)).toEqual(step)
  })

  test("refuses a member from another organization with validation_failed and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { member: outsider } = await createMember(db, await createOrganization(db), "viewer")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    expectError(await reassign(run, step!, { type: "member", memberId: outsider.id }), 400, "validation_failed")
    expect(await storedRunStep(step!.id)).toEqual(step)
  })

  test("refuses a group from another organization with validation_failed and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const teamId = await createGroup(db, await createOrganization(db))
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    expectError(await reassign(run, step!, { type: "team", teamId }), 400, "validation_failed")
    expect(await storedRunStep(step!.id)).toEqual(step)
  })

  test.each([
    ["a member assignee without a member ID", { type: "member" }],
    ["an unknown assignee type", { type: "everyone" }],
  ])("refuses %s with validation_failed", async (_description, assignee) => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    expectError(await reassign(run, step!, assignee), 400, "validation_failed")
  })

  test("refuses a body without an assignee with validation_failed", async () => {
    const { organization } = await signedInMember("owner")
    const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

    expectError(await api().patch(`${stepPath(run, step!)}/assignee`).send({}), 400, "validation_failed")
  })

  test.each([
    ["completed", { status: "completed" as const, completedAt: new Date(), completedBy: "user_someone_else" }],
    ["skipped", { status: "skipped" as const, completedAt: new Date(), completedBy: "user_someone_else", skipReason: "Not needed" }],
  ])("refuses a %s step with conflict and changes nothing", async (_status, values) => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{ skippable: true }])
    const run = await insertRun(version)
    const step = await insertRunStep(run, templateStep!, values)

    expectError(await reassign(run, step, { type: "role", role: "editor" }), 409, "conflict")
    expect(await storedRunStep(step.id)).toEqual(step)
  })

  test.each([
    ["completed", { status: "completed" as const, completedAt: new Date() }],
    ["cancelled", { status: "cancelled" as const }],
  ])("refuses a step of a %s run with conflict and changes nothing", async (_status, values) => {
    const { organization } = await signedInMember("owner")
    const { version, templateSteps: [templateStep] } = await publishedTemplate(organization, [{}])
    const run = await insertRun(version, values)
    const step = await insertRunStep(run, templateStep!)

    expectError(await reassign(run, step, { type: "role", role: "editor" }), 409, "conflict")
    expect(await storedRunStep(step.id)).toEqual(step)
  })

  test("refuses a step from another run with not_found and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { run } = await runWithSteps(organization, [{}])
    const { runSteps: [otherStep] } = await runWithSteps(organization, [{}])

    expectError(await reassign(run, otherStep!, null), 404, "not_found")
    expect(await storedRunStep(otherStep!.id)).toEqual(otherStep)
  })
})
