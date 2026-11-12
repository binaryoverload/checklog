import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import type { TemplateField } from "@/util/types.ts"
import type { TemplateFieldDto } from "@checklog/shared/api"
import { typeIdForTable } from "@checklog/shared/utils"
import { insertTemplateField, insertTemplateStep } from "@test/support/database.ts"
import { signedInMember, stubSessions } from "@test/support/session.ts"
import {
  draftFieldIn,
  draftStepIn,
  draftWithSteps,
  fieldsOf,
  keysOf,
  publishedWithDraft,
  publishedWithSteps,
  storedField,
  versionsOf,
} from "@test/support/template-drafts.ts"
import { api, describeTemplateAccess, expectError, expectStatus } from "@test/support/template-routes.ts"
import type { TemplateRoute } from "@test/support/template-routes.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates.

stubSessions()

const textOptions = { type: "text", multiLine: false }

const fieldRoutes: TemplateRoute[] = [
  {
    name: "POST /api/templates/:templateId/draft/steps/:stepId/fields",
    send: async (id) => {
      const step = await draftStepIn(id)
      return api().post(`/api/templates/${id}/draft/steps/${step.id}/fields`).send({ label: "Reading", key: "reading", options: textOptions })
    },
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
  },
  {
    name: "PATCH /api/templates/:templateId/draft/steps/:stepId/fields/:fieldId",
    send: async (id) => {
      const field = await draftFieldIn(id)
      return api().patch(`/api/templates/${id}/draft/steps/${field.templateStepId}/fields/${field.id}`).send({ label: "Renamed", updatedAt: field.updatedAt.toISOString() })
    },
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
  },
  {
    name: "PUT /api/templates/:templateId/draft/steps/:stepId/fields/order",
    send: async (id) => {
      const field = await draftFieldIn(id)
      return api().put(`/api/templates/${id}/draft/steps/${field.templateStepId}/fields/order`).send({ fieldIds: [field.id] })
    },
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
  },
  {
    name: "DELETE /api/templates/:templateId/draft/steps/:stepId/fields/:fieldId",
    send: async (id) => {
      const field = await draftFieldIn(id)
      return api().delete(`/api/templates/${id}/draft/steps/${field.templateStepId}/fields/${field.id}`)
    },
    needs: "edit",
    impersonation: "allow",
    status: "active",
    conflictStatus: "archived",
    successStatus: 204,
  },
]

describeTemplateAccess(fieldRoutes)

// A step in a new template's draft with fields with these keys, at positions 0 to n−1
async function stepWithFields(keys: string[] = []) {
  const { organization } = await signedInMember("owner")
  const { template, draft, steps: [step] } = await draftWithSteps(organization, ["Step"])
  const fields: TemplateField[] = []
  for (const [position, key] of keys.entries()) fields.push(await insertTemplateField(db, step!, { key, position }))
  return { organization, template, draft, step: step!, fields }
}

describe("POST /api/templates/:templateId/draft/steps/:stepId/fields", () => {
  const addField = (templateId: string, stepId: string, body: object) =>
    api().post(`/api/templates/${templateId}/draft/steps/${stepId}/fields`).send(body)

  test("adds a field at the end of the step and returns it", async () => {
    const { template, draft, step } = await stepWithFields(["first"])

    const response = await addField(template.id, step.id, { label: "Reading", key: "reading", options: textOptions })

    expectStatus(response, 200)
    const body = response.body as TemplateFieldDto
    expect(body).toMatchObject({
      templateVersionId: draft.id,
      templateStepId: step.id,
      label: "Reading",
      key: "reading",
      position: 1,
      type: "text",
    })
    expect(body).not.toHaveProperty("organizationId")
    expect(await storedField(body.id)).toBeDefined()
    expect(await keysOf(step)).toEqual(["first", "reading"])
  })

  test("records who added the field", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, steps: [step] } = await draftWithSteps(organization, ["Step"])

    const response = await addField(template.id, step!.id, { label: "Reading", key: "reading", options: textOptions })

    expect(response.body).toMatchObject({ createdBy: member.userId })
  })

  test("adds the first field to a step at position 0", async () => {
    const { template, step } = await stepWithFields()

    expectStatus(await addField(template.id, step.id, { label: "Only", key: "only", options: textOptions }), 200)

    expect((await fieldsOf(step)).map(field => field.position)).toEqual([0])
  })

  test("counts positions within the step, not across the draft", async () => {
    const { template, draft, step } = await stepWithFields(["first", "second"])
    const otherStep = await insertTemplateStep(db, draft, { title: "Other", position: 1 })

    const response = await addField(template.id, otherStep.id, { label: "Other", key: "other", options: textOptions })

    expect(response.body).toMatchObject({ position: 0 })
    expect((await fieldsOf(step)).map(field => field.position)).toEqual([0, 1])
  })

  test("gives a field with only a label, key and options the default settings", async () => {
    const { template, step } = await stepWithFields()

    const response = await addField(template.id, step.id, { label: "Reading", key: "reading", options: textOptions })

    expect(response.body).toMatchObject({ required: true, helpText: null })
  })

  test("stores every setting it's given, taking the type from the options", async () => {
    const { template, step } = await stepWithFields()
    const options = { type: "dropdown", choices: [{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }], multiple: false }

    const response = await addField(template.id, step.id, { label: "Result", key: "result", helpText: "Pick one", required: false, options })

    expectStatus(response, 200)
    expect(await storedField((response.body as TemplateFieldDto).id)).toMatchObject({
      label: "Result",
      key: "result",
      helpText: "Pick one",
      required: false,
      type: "dropdown",
      options,
    })
  })

  test.each([
    ["text", { type: "text", multiLine: true, minLength: 1, maxLength: 200, pattern: "^[A-Z]+$" }],
    ["number", { type: "number", decimalPlaces: 1, min: 0, max: 100, unit: "°C" }],
    ["date", { type: "date", dateType: "datetime", allowFuture: false }],
    ["checkbox", { type: "checkbox" }],
  ])("adds a %s field", async (type, options) => {
    const { template, step } = await stepWithFields()

    const response = await addField(template.id, step.id, { label: "Field", key: "field", options })

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ type, options })
  })

  test("adds a field to an approval step", async () => {
    const { organization, member } = await signedInMember("owner")
    const { template, draft } = await draftWithSteps(organization)
    const step = await insertTemplateStep(db, draft, { kind: "approval", assigneeType: "member", assigneeMemberId: member.id })

    expectStatus(await addField(template.id, step.id, { label: "Comments", key: "comments", options: textOptions }), 200)

    expect(await keysOf(step)).toEqual(["comments"])
  })

  test("allows a key used in the published version but not in the draft", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [step] } = await publishedWithDraft(organization, ["Step"])
    await insertTemplateField(db, await insertTemplateStep(db, published, { position: 1 }), { key: "reading" })

    expectStatus(await addField(template.id, step!.id, { label: "Reading", key: "reading", options: textOptions }), 200)

    expect(await keysOf(step!)).toEqual(["reading"])
  })

  test("refuses a key another step in the draft already uses with conflict and adds nothing", async () => {
    const { template, draft, step } = await stepWithFields(["reading"])
    const otherStep = await insertTemplateStep(db, draft, { title: "Other", position: 1 })

    expectError(await addField(template.id, otherStep.id, { label: "Reading", key: "reading", options: textOptions }), 409, "conflict")
    expect(await keysOf(otherStep)).toEqual([])
    expect(await keysOf(step)).toEqual(["reading"])
  })

  test.each([
    ["no label", { key: "reading", options: textOptions }],
    ["an empty label", { label: "", key: "reading", options: textOptions }],
    ["no key", { label: "Reading", options: textOptions }],
    ["an empty key", { label: "Reading", key: "", options: textOptions }],
    ["a key with capital letters", { label: "Reading", key: "Reading", options: textOptions }],
    ["a key starting with a digit", { label: "Reading", key: "1st_reading", options: textOptions }],
    ["a key starting with an underscore", { label: "Reading", key: "_reading", options: textOptions }],
    ["a key with a hyphen", { label: "Reading", key: "first-reading", options: textOptions }],
    ["a key with a space", { label: "Reading", key: "first reading", options: textOptions }],
    ["no options", { label: "Reading", key: "reading" }],
    ["an unknown field type", { label: "Reading", key: "reading", options: { type: "signature" } }],
    ["options missing a setting for their type", { label: "Reading", key: "reading", options: { type: "text" } }],
    ["a minimum length above the maximum", { label: "Reading", key: "reading", options: { type: "text", multiLine: false, minLength: 5, maxLength: 2 } }],
    ["a minimum above the maximum", { label: "Reading", key: "reading", options: { type: "number", min: 10, max: 1 } }],
    ["a separate type beside the options", { label: "Reading", key: "reading", type: "number", options: textOptions }],
    ["a required setting that isn't a boolean", { label: "Reading", key: "reading", required: "yes", options: textOptions }],
  ])("refuses %s with validation_failed and adds nothing", async (_description, body) => {
    const { template, step } = await stepWithFields(["existing"])

    expectError(await addField(template.id, step.id, body), 400, "validation_failed")
    expect(await keysOf(step)).toEqual(["existing"])
  })

  test("accepts keys with lowercase letters, digits and underscores starting with a letter", async () => {
    const { template, step } = await stepWithFields()

    expectStatus(await addField(template.id, step.id, { label: "Reading", key: "reading_2b", options: textOptions }), 200)
  })

  test("refuses a template with no draft with conflict and creates no draft", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [publishedStep] } = await publishedWithSteps(organization, ["Published"])

    expectError(await addField(template.id, publishedStep!.id, { label: "Reading", key: "reading", options: textOptions }), 409, "conflict")
    expect((await versionsOf(template)).map(version => version.id)).toEqual([published.id])
    expect(await keysOf(publishedStep!)).toEqual([])
  })

  test("refuses a step from the published version with not_found and adds nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithDraft(organization, ["Draft step"])
    const publishedStep = await insertTemplateStep(db, published, { position: 1 })

    expectError(await addField(template.id, publishedStep.id, { label: "Reading", key: "reading", options: textOptions }), 404, "not_found")
    expect(await keysOf(publishedStep)).toEqual([])
  })

  test("refuses a step from another template's draft with not_found and adds nothing", async () => {
    const { template, organization } = await stepWithFields()
    const { steps: [otherStep] } = await draftWithSteps(organization, ["Other"])

    expectError(await addField(template.id, otherStep!.id, { label: "Reading", key: "reading", options: textOptions }), 404, "not_found")
    expect(await keysOf(otherStep!)).toEqual([])
  })

  test("refuses a step ID that doesn't exist with not_found", async () => {
    const { template } = await stepWithFields()

    expectError(await addField(template.id, typeIdForTable("templateSteps").toString(), { label: "Reading", key: "reading", options: textOptions }), 404, "not_found")
  })

  test("refuses a step ID for another table with validation_failed", async () => {
    const { template } = await stepWithFields()

    expectError(await addField(template.id, typeIdForTable("templateFields").toString(), { label: "Reading", key: "reading", options: textOptions }), 400, "validation_failed")
  })
})

describe("PATCH /api/templates/:templateId/draft/steps/:stepId/fields/:fieldId", () => {
  const editField = (templateId: string, field: Pick<TemplateField, "id" | "templateStepId" | "updatedAt">, body: object) =>
    api()
      .patch(`/api/templates/${templateId}/draft/steps/${field.templateStepId}/fields/${field.id}`)
      .send({ updatedAt: field.updatedAt.toISOString(), ...body })

  test("changes only the settings it's given and returns the field", async () => {
    const { template, step } = await stepWithFields()
    const field = await insertTemplateField(db, step, { key: "reading", label: "Reading", helpText: "Keep this", required: false })

    const response = await editField(template.id, field, { label: "Renamed" })

    expectStatus(response, 200)
    expect(response.body).toMatchObject({ id: field.id, label: "Renamed", key: "reading", helpText: "Keep this", required: false })
    expect(response.body).not.toHaveProperty("organizationId")
    expect(await storedField(field.id)).toMatchObject({ label: "Renamed", key: "reading", helpText: "Keep this", required: false, type: "text" })
  })

  test("changes the key", async () => {
    const { template, fields: [field] } = await stepWithFields(["reading"])

    expectStatus(await editField(template.id, field!, { key: "temperature" }), 200)

    expect((await storedField(field!.id))!.key).toBe("temperature")
  })

  test("keeps the field's own key without a conflict", async () => {
    const { template, fields: [field] } = await stepWithFields(["reading"])

    expectStatus(await editField(template.id, field!, { key: "reading", label: "Renamed" }), 200)
  })

  test("changes the type by changing the options", async () => {
    const { template, fields: [field] } = await stepWithFields(["reading"])
    const options = { type: "number", min: 0 }

    const response = await editField(template.id, field!, { options })

    expect(response.body).toMatchObject({ type: "number", options })
    expect(await storedField(field!.id)).toMatchObject({ type: "number", options })
  })

  test("clears the help text when it's set to null", async () => {
    const { template, step } = await stepWithFields()
    const field = await insertTemplateField(db, step, { helpText: "Remove me" })

    expect((await editField(template.id, field, { helpText: null })).body).toMatchObject({ helpText: null })
    expect((await storedField(field.id))!.helpText).toBeNull()
  })

  test("moves updatedAt forward, so the old value can't be used again", async () => {
    const { template, fields: [field] } = await stepWithFields(["reading"])

    const first = await editField(template.id, field!, { label: "Once" })
    const second = await editField(template.id, field!, { label: "Twice" })

    expect(new Date((first.body as TemplateFieldDto).updatedAt).getTime()).toBeGreaterThan(field!.updatedAt.getTime())
    expectError(second, 409, "conflict")
    expect((await storedField(field!.id))!.label).toBe("Once")
  })

  test("refuses an edit made from an out-of-date copy with conflict and changes nothing", async () => {
    const { template, fields: [field] } = await stepWithFields(["reading"])

    expectError(await editField(template.id, { id: field!.id, templateStepId: field!.templateStepId, updatedAt: new Date(field!.updatedAt.getTime() - 1000) }, { label: "Stale" }), 409, "conflict")
    expect(await storedField(field!.id)).toEqual(field)
  })

  test("refuses an edit without updatedAt with validation_failed", async () => {
    const { template, fields: [field] } = await stepWithFields(["reading"])

    expectError(await api().patch(`/api/templates/${template.id}/draft/steps/${field!.templateStepId}/fields/${field!.id}`).send({ label: "Renamed" }), 400, "validation_failed")
    expect(await storedField(field!.id)).toEqual(field)
  })

  test("refuses an edit with only updatedAt with validation_failed", async () => {
    const { template, fields: [field] } = await stepWithFields(["reading"])

    expectError(await editField(template.id, field!, {}), 400, "validation_failed")
    expect(await storedField(field!.id)).toEqual(field)
  })

  test("refuses a key another field in the draft uses with conflict and changes nothing", async () => {
    const { template, draft, fields: [reading] } = await stepWithFields(["reading"])
    const otherStep = await insertTemplateStep(db, draft, { title: "Other", position: 1 })
    const other = await insertTemplateField(db, otherStep, { key: "other" })

    expectError(await editField(template.id, other, { key: "reading" }), 409, "conflict")
    expect(await storedField(other.id)).toEqual(other)
    expect(await storedField(reading!.id)).toEqual(reading)
  })

  test.each([
    ["an empty label", { label: "" }],
    ["a key with capital letters", { key: "Reading" }],
    ["a key starting with a digit", { key: "2nd" }],
    ["an unknown field type", { options: { type: "signature" } }],
    ["a minimum above the maximum", { options: { type: "number", min: 10, max: 1 } }],
    ["a separate type beside the options", { type: "number" }],
  ])("refuses %s with validation_failed and changes nothing", async (_description, body) => {
    const { template, fields: [field] } = await stepWithFields(["reading"])

    expectError(await editField(template.id, field!, body), 400, "validation_failed")
    expect(await storedField(field!.id)).toEqual(field)
  })

  test("refuses a template with no draft with conflict and creates no draft", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [publishedStep] } = await publishedWithSteps(organization, ["Published"])
    const field = await insertTemplateField(db, publishedStep!)

    expectError(await editField(template.id, field, { label: "Changed" }), 409, "conflict")
    expect((await versionsOf(template)).map(version => version.id)).toEqual([published.id])
    expect(await storedField(field.id)).toEqual(field)
  })

  test("refuses a field from the published version with not_found and changes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithDraft(organization, ["Draft step"])
    const field = await insertTemplateField(db, await insertTemplateStep(db, published, { position: 1 }))

    expectError(await editField(template.id, field, { label: "Changed" }), 404, "not_found")
    expect(await storedField(field.id)).toEqual(field)
  })

  test("refuses a field from another template's draft with not_found and changes nothing", async () => {
    const { template, organization } = await stepWithFields()
    const { steps: [otherStep] } = await draftWithSteps(organization, ["Other"])
    const field = await insertTemplateField(db, otherStep!)

    expectError(await editField(template.id, field, { label: "Changed" }), 404, "not_found")
    expect(await storedField(field.id)).toEqual(field)
  })

  test("refuses a field on another step of the draft with not_found and changes nothing", async () => {
    const { template, draft, fields: [field] } = await stepWithFields(["reading"])
    const otherStep = await insertTemplateStep(db, draft, { title: "Other", position: 1 })

    expectError(await editField(template.id, { ...field!, templateStepId: otherStep.id }, { label: "Changed" }), 404, "not_found")
    expect(await storedField(field!.id)).toEqual(field)
  })

  test("refuses a step ID for another table with validation_failed", async () => {
    const { template, fields: [field] } = await stepWithFields(["reading"])

    expectError(await editField(template.id, { ...field!, templateStepId: typeIdForTable("templateFields").toString() }, { label: "Changed" }), 400, "validation_failed")
  })

  test("refuses a field ID that doesn't exist with not_found", async () => {
    const { template } = await stepWithFields()

    expectError(await editField(template.id, { id: typeIdForTable("templateFields").toString(), templateStepId: typeIdForTable("templateSteps").toString(), updatedAt: new Date() }, { label: "Changed" }), 404, "not_found")
  })

  test("refuses a field ID for another table with validation_failed", async () => {
    const { template } = await stepWithFields()

    expectError(await editField(template.id, { id: typeIdForTable("templateSteps").toString(), templateStepId: typeIdForTable("templateSteps").toString(), updatedAt: new Date() }, { label: "Changed" }), 400, "validation_failed")
  })
})

describe("PUT /api/templates/:templateId/draft/steps/:stepId/fields/order", () => {
  const reorder = (templateId: string, stepId: string, fieldIds: string[]) =>
    api().put(`/api/templates/${templateId}/draft/steps/${stepId}/fields/order`).send({ fieldIds })

  test("puts the step's fields in the given order", async () => {
    const { template, step, fields: [first, second, third] } = await stepWithFields(["first", "second", "third"])

    expectStatus(await reorder(template.id, step.id, [third!.id, first!.id, second!.id]), 200)

    const fields = await fieldsOf(step)
    expect(fields.map(field => field.key)).toEqual(["third", "first", "second"])
    expect(fields.map(field => field.position)).toEqual([0, 1, 2])
  })

  test("returns the fields in their new order", async () => {
    const { template, step, fields: [first, second] } = await stepWithFields(["first", "second"])

    const response = await reorder(template.id, step.id, [second!.id, first!.id])

    const body = response.body as TemplateFieldDto[]
    expect(body.map(field => [field.key, field.position])).toEqual([["second", 0], ["first", 1]])
    expect(body[0]).not.toHaveProperty("organizationId")
  })

  test("moves each field's updatedAt forward and returns the new value", async () => {
    const { template, step, fields } = await stepWithFields(["first", "second"])
    const [first, second] = fields as [TemplateField, TemplateField]

    const response = await reorder(template.id, step.id, [second.id, first.id])

    for (const field of [first, second]) {
      const stored = (await storedField(field.id))!
      const returned = (response.body as TemplateFieldDto[]).find(dto => dto.id === field.id)!
      expect(stored.updatedAt.getTime()).toBeGreaterThan(field.updatedAt.getTime())
      expect(returned.updatedAt).toBe(stored.updatedAt.toISOString())
    }
  })

  test("leaves the fields of other steps as they were", async () => {
    const { template, draft, step, fields: [first, second] } = await stepWithFields(["first", "second"])
    const otherStep = await insertTemplateStep(db, draft, { title: "Other", position: 1 })
    const otherField = await insertTemplateField(db, otherStep, { key: "other" })

    expectStatus(await reorder(template.id, step.id, [second!.id, first!.id]), 200)

    expect(await storedField(otherField.id)).toEqual(otherField)
  })

  test("rewrites positions with gaps to 0 to n−1", async () => {
    const { template, step } = await stepWithFields()
    const first = await insertTemplateField(db, step, { key: "first", position: 3 })
    const second = await insertTemplateField(db, step, { key: "second", position: 7 })

    expectStatus(await reorder(template.id, step.id, [first.id, second.id]), 200)

    expect((await fieldsOf(step)).map(field => field.position)).toEqual([0, 1])
  })

  test("accepts an empty list for a step with no fields", async () => {
    const { template, step } = await stepWithFields()

    expectStatus(await reorder(template.id, step.id, []), 200)
  })

  test("refuses a list missing a field with validation_failed and changes nothing", async () => {
    const { template, step, fields: [first, second] } = await stepWithFields(["first", "second", "third"])

    expectError(await reorder(template.id, step.id, [second!.id, first!.id]), 400, "validation_failed")
    expect(await keysOf(step)).toEqual(["first", "second", "third"])
  })

  test("refuses a list with a field twice with validation_failed and changes nothing", async () => {
    const { template, step, fields: [first, second] } = await stepWithFields(["first", "second"])

    expectError(await reorder(template.id, step.id, [second!.id, first!.id, second!.id]), 400, "validation_failed")
    expect(await keysOf(step)).toEqual(["first", "second"])
  })

  test("refuses a list with a field from another step with validation_failed and changes nothing", async () => {
    const { template, draft, step, fields: [first, second] } = await stepWithFields(["first", "second"])
    const otherStep = await insertTemplateStep(db, draft, { title: "Other", position: 1 })
    const otherField = await insertTemplateField(db, otherStep, { key: "other" })

    expectError(await reorder(template.id, step.id, [second!.id, first!.id, otherField.id]), 400, "validation_failed")
    expect(await keysOf(step)).toEqual(["first", "second"])
    expect(await storedField(otherField.id)).toEqual(otherField)
  })

  test("refuses a list with an ID for another table with validation_failed", async () => {
    const { template, step, fields: [first] } = await stepWithFields(["first"])

    expectError(await reorder(template.id, step.id, [first!.id, typeIdForTable("templateSteps").toString()]), 400, "validation_failed")
  })

  test("refuses a body without fieldIds with validation_failed", async () => {
    const { template, step } = await stepWithFields(["first"])

    expectError(await api().put(`/api/templates/${template.id}/draft/steps/${step.id}/fields/order`).send({}), 400, "validation_failed")
  })

  test("refuses a template with no draft with conflict and creates no draft", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [publishedStep] } = await publishedWithSteps(organization, ["Published"])
    const first = await insertTemplateField(db, publishedStep!, { key: "first", position: 0 })
    const second = await insertTemplateField(db, publishedStep!, { key: "second", position: 1 })

    expectError(await reorder(template.id, publishedStep!.id, [second.id, first.id]), 409, "conflict")
    expect((await versionsOf(template)).map(version => version.id)).toEqual([published.id])
    expect(await keysOf(publishedStep!)).toEqual(["first", "second"])
  })

  test("refuses a step from the published version with not_found", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithDraft(organization, ["Draft step"])
    const publishedStep = await insertTemplateStep(db, published, { position: 1 })
    const field = await insertTemplateField(db, publishedStep)

    expectError(await reorder(template.id, publishedStep.id, [field.id]), 404, "not_found")
  })

  test("refuses a step from another template's draft with not_found", async () => {
    const { template, organization } = await stepWithFields()
    const { steps: [otherStep] } = await draftWithSteps(organization, ["Other"])
    const field = await insertTemplateField(db, otherStep!)

    expectError(await reorder(template.id, otherStep!.id, [field.id]), 404, "not_found")
  })

  test("refuses a step ID that doesn't exist with not_found", async () => {
    const { template } = await stepWithFields()

    expectError(await reorder(template.id, typeIdForTable("templateSteps").toString(), []), 404, "not_found")
  })
})

describe("DELETE /api/templates/:templateId/draft/steps/:stepId/fields/:fieldId", () => {
  const deleteField = (templateId: string, field: { id: string, templateStepId: string }) =>
    api().delete(`/api/templates/${templateId}/draft/steps/${field.templateStepId}/fields/${field.id}`)

  test("removes the field and closes the gap in the step's positions", async () => {
    const { template, step, fields: [, second] } = await stepWithFields(["first", "second", "third"])

    const response = await deleteField(template.id, second!)

    expectStatus(response, 204)
    expect(response.text).toBe("")

    const fields = await fieldsOf(step)
    expect(fields.map(field => field.key)).toEqual(["first", "third"])
    expect(fields.map(field => field.position)).toEqual([0, 1])
  })

  test("moves the updatedAt of the fields it renumbers forward", async () => {
    const { template, fields: [first, second] } = await stepWithFields(["first", "second"])

    expectStatus(await deleteField(template.id, first!), 204)

    expect((await storedField(second!.id))!.updatedAt.getTime()).toBeGreaterThan(second!.updatedAt.getTime())
  })

  test("leaves the fields of other steps as they were", async () => {
    const { template, draft, fields: [first] } = await stepWithFields(["first", "second"])
    const otherStep = await insertTemplateStep(db, draft, { title: "Other", position: 1 })
    const otherField = await insertTemplateField(db, otherStep, { key: "other", position: 1 })

    expectStatus(await deleteField(template.id, first!), 204)

    expect(await storedField(otherField.id)).toEqual(otherField)
  })

  test("frees the key for another field", async () => {
    const { template, step, fields: [field] } = await stepWithFields(["reading"])

    expectStatus(await deleteField(template.id, field!), 204)

    expect(await keysOf(step)).toEqual([])
    await expect(insertTemplateField(db, step, { key: "reading" })).resolves.toBeDefined()
  })

  test("refuses a template with no draft with conflict and deletes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published, steps: [publishedStep] } = await publishedWithSteps(organization, ["Published"])
    const field = await insertTemplateField(db, publishedStep!)

    expectError(await deleteField(template.id, field), 409, "conflict")
    expect((await versionsOf(template)).map(version => version.id)).toEqual([published.id])
    expect(await storedField(field.id)).toEqual(field)
  })

  test("refuses a field from the published version with not_found and deletes nothing", async () => {
    const { organization } = await signedInMember("owner")
    const { template, published } = await publishedWithDraft(organization, ["Draft step"])
    const field = await insertTemplateField(db, await insertTemplateStep(db, published, { position: 1 }))

    expectError(await deleteField(template.id, field), 404, "not_found")
    expect(await storedField(field.id)).toEqual(field)
  })

  test("refuses a field from another template's draft with not_found and deletes nothing", async () => {
    const { template, organization } = await stepWithFields()
    const { steps: [otherStep] } = await draftWithSteps(organization, ["Other"])
    const field = await insertTemplateField(db, otherStep!)

    expectError(await deleteField(template.id, field), 404, "not_found")
    expect(await storedField(field.id)).toEqual(field)
  })

  test("refuses a field on another step of the draft with not_found and deletes nothing", async () => {
    const { template, draft, fields: [field] } = await stepWithFields(["reading"])
    const otherStep = await insertTemplateStep(db, draft, { title: "Other", position: 1 })

    expectError(await deleteField(template.id, { ...field!, templateStepId: otherStep.id }), 404, "not_found")
    expect(await storedField(field!.id)).toEqual(field)
  })

  test("refuses a step ID for another table with validation_failed", async () => {
    const { template, fields: [field] } = await stepWithFields(["reading"])

    expectError(await deleteField(template.id, { ...field!, templateStepId: typeIdForTable("templateFields").toString() }), 400, "validation_failed")
  })

  test("refuses a field ID that doesn't exist with not_found", async () => {
    const { template, step } = await stepWithFields()

    expectError(await deleteField(template.id, { id: typeIdForTable("templateFields").toString(), templateStepId: step.id }), 404, "not_found")
  })

  test("refuses a field that's already been deleted with not_found", async () => {
    const { template, fields: [field] } = await stepWithFields(["reading"])

    expectStatus(await deleteField(template.id, field!), 204)
    expectError(await deleteField(template.id, field!), 404, "not_found")
  })

  test("refuses a field ID for another table with validation_failed", async () => {
    const { template, step } = await stepWithFields()

    expectError(await deleteField(template.id, { id: typeIdForTable("templateSteps").toString(), templateStepId: step.id }), 400, "validation_failed")
  })
})
