import { asc, eq } from "drizzle-orm"
import type request from "supertest"
import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import type { templateFields, templateSteps } from "@/db/schema.ts"
import { runFieldValues, runs, runSteps, stepNotes, templateVersions } from "@/db/schema.ts"
import type { Organization, Run, RunStep, Template, TemplateField, TemplateStep, TemplateVersion } from "@/util/types.ts"
import type { FieldValue } from "@checklog/shared/domain"
import { typeIdForTable } from "@checklog/shared/utils"
import {
  createOrganization,
  insertTemplate,
  insertTemplateField,
  insertTemplateStep,
  insertTemplateVersion,
  setCurrentVersion,
} from "@test/support/database.ts"
import { expectError } from "@test/support/http.ts"
import { signedInMember } from "@test/support/session.ts"

export type StepSpec = Partial<typeof templateSteps.$inferInsert> & {
  fields?: Partial<typeof templateFields.$inferInsert>[]
}

// Default keys are numbered, since keys are unique within a version
let fieldKeyCount = 0

// A template with a published current version holding these steps and their fields, at positions 0 to n−1
export async function publishedTemplate(organization: Organization, steps: StepSpec[], options: { createdBy?: string } = {}) {
  const inserted = await insertTemplate(db, organization, options)
  const version = await insertTemplateVersion(db, inserted, 1, "published")
  const template = await setCurrentVersion(db, inserted, version)
  const stepRows: TemplateStep[] = []
  const fields: TemplateField[][] = []
  for (const [position, { fields: stepFields = [], ...spec }] of steps.entries()) {
    const step = await insertTemplateStep(db, version, { title: `Step ${position + 1}`, position, ...spec })
    stepRows.push(step)
    const fieldRows: TemplateField[] = []
    for (const [fieldPosition, field] of stepFields.entries()) {
      fieldRows.push(await insertTemplateField(db, step, { key: `run_field_${++fieldKeyCount}`, position: fieldPosition, ...field }))
    }
    fields.push(fieldRows)
  }
  return { template, version, templateSteps: stepRows, fields }
}

export async function insertRun(version: TemplateVersion, values: Partial<typeof runs.$inferInsert> = {}): Promise<Run> {
  const [run] = await db.insert(runs).values({
    organizationId: version.organizationId,
    templateVersionId: version.id,
    name: "Test run",
    timezone: "Europe/London",
    createdBy: "user_someone_else",
    ...values,
  }).returning()
  return run!
}

export async function insertRunStep(
  run: Run,
  templateStep: TemplateStep,
  values: Partial<typeof runSteps.$inferInsert> = {},
): Promise<RunStep> {
  const [step] = await db.insert(runSteps).values({
    organizationId: run.organizationId,
    runId: run.id,
    templateVersionId: run.templateVersionId,
    templateStepId: templateStep.id,
    assigneeType: templateStep.assigneeType,
    assigneeMemberId: templateStep.assigneeMemberId,
    assigneeTeamId: templateStep.assigneeTeamId,
    assigneeRole: templateStep.assigneeRole,
    createdBy: "user_someone_else",
    ...values,
  }).returning()
  return step!
}

export async function insertFieldValue(step: RunStep, field: TemplateField, value: FieldValue | null) {
  const [row] = await db.insert(runFieldValues).values({
    organizationId: step.organizationId,
    runStepId: step.id,
    templateFieldId: field.id,
    value,
    createdBy: "user_someone_else",
    updatedBy: "user_someone_else",
  }).returning()
  return row!
}

export async function insertNote(step: RunStep, body: string) {
  const [row] = await db.insert(stepNotes).values({
    organizationId: step.organizationId,
    runStepId: step.id,
    body,
    createdBy: "user_someone_else",
  }).returning()
  return row!
}

// A run of a new template with one run step per template step, all pending
export async function runWithSteps(organization: Organization, steps: StepSpec[], options: { createdBy?: string } = {}) {
  const published = await publishedTemplate(organization, steps, options)
  const run = await insertRun(published.version)
  const stepRows: RunStep[] = []
  for (const templateStep of published.templateSteps) stepRows.push(await insertRunStep(run, templateStep))
  return { ...published, run, runSteps: stepRows }
}

export async function storedRun(runId: string) {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId))
  return row
}

export async function storedRunStep(stepId: string) {
  const [row] = await db.select().from(runSteps).where(eq(runSteps.id, stepId))
  return row
}

export async function runsOf(template: Template) {
  const versions = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, template.id))
  const rows: Run[] = []
  for (const version of versions) rows.push(...await db.select().from(runs).where(eq(runs.templateVersionId, version.id)))
  return rows
}

export async function stepsOfRun(run: Run) {
  return db.select().from(runSteps).where(eq(runSteps.runId, run.id)).orderBy(asc(runSteps.createdAt), asc(runSteps.id))
}

export async function valuesOf(step: RunStep) {
  return db.select().from(runFieldValues).where(eq(runFieldValues.runStepId, step.id))
}

export async function notesOf(step: RunStep) {
  return db.select().from(stepNotes).where(eq(stepNotes.runStepId, step.id)).orderBy(asc(stepNotes.createdAt), asc(stepNotes.id))
}

// Checks a precondition_failed refusal points at each of these, whatever the shape of its details.
// An array means any one of its IDs, for a problem that could point at the run step or its template step.
export function expectPreconditionFailed(response: request.Response, ids: (string | string[])[]) {
  expectError(response, 400, "precondition_failed")
  const details = JSON.stringify(response.body.error.details ?? [])
  for (const id of ids) {
    const options = Array.isArray(id) ? id : [id]
    expect(options.some(option => details.includes(option)), `details point at one of ${options.join(", ")}: ${details}`).toBe(true)
  }
}

// A route on one run, so the ID and visibility rules are checked the same way for each
export interface RunRoute {
  name: string
  // Sends the request for this run, or for a run step of it when the route is on a step
  send: (run: Run, step: RunStep | { id: string }) => PromiseLike<request.Response>
  // The status a successful request returns, when it isn't 200
  successStatus?: number
}

// Call from a file that calls stubSessions()
export function describeRunVisibility(routes: RunRoute[]): void {
  // A loop rather than describe.each, which shortens long route names in the title so -t filters can miss them
  for (const route of routes) describe(`${route.name} visibility`, () => {
    test("refuses a run the member can't see with not_found and changes nothing", async () => {
      const { organization } = await signedInMember("viewer")
      const { run, runSteps: [step] } = await runWithSteps(organization, [{}])

      expectError(await route.send(run, step!), 404, "not_found")
      expect(await storedRun(run.id)).toEqual(run)
      expect(await storedRunStep(step!.id)).toEqual(step)
    })

    test("refuses another organization's run with not_found and changes nothing", async () => {
      const { run, runSteps: [step] } = await runWithSteps(await createOrganization(db), [{}])
      await signedInMember("owner")

      expectError(await route.send(run, step!), 404, "not_found")
      expect(await storedRun(run.id)).toEqual(run)
    })

    test("refuses a run ID that doesn't exist with not_found", async () => {
      const { organization } = await signedInMember("owner")
      const { runSteps: [step] } = await runWithSteps(organization, [{}])

      expectError(await route.send({ id: typeIdForTable("runs").toString() } as Run, step!), 404, "not_found")
    })

    test.each([
      ["a run ID that isn't a TypeID", "not-an-id"],
      ["a run ID for another table", typeIdForTable("templates").toString()],
    ])("refuses %s with validation_failed", async (_description, runId) => {
      const { organization } = await signedInMember("owner")
      const { runSteps: [step] } = await runWithSteps(organization, [{}])

      expectError(await route.send({ id: runId } as Run, step!), 400, "validation_failed")
    })

    test("refuses a signed-out request with unauthorized", async () => {
      const { run, runSteps: [step] } = await runWithSteps(await createOrganization(db), [{}])

      expectError(await route.send(run, step!), 401, "unauthorized")
    })
  })
}
