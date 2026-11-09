import { eq, sql } from "drizzle-orm"
import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import { templateFields, templates, templateSteps, templateVersions } from "@/db/schema.ts"
import { ensureDraft } from "@/services/templates.ts"
import type { Database, TemplateVersion } from "@/util/types.ts"
import { typeIdForTable } from "@checklog/shared/utils"
import {
  createMember,
  createOrganization,
  inRollback,
  insertTemplate,
  insertTemplateField,
  insertTemplateStep,
  insertTemplateVersion,
  setCurrentVersion,
} from "@test/support/database.ts"

async function versionsOf(tx: Database, templateId: string) {
  return tx.select().from(templateVersions).where(eq(templateVersions.templateId, templateId)).orderBy(templateVersions.version)
}

async function stepsOf(tx: Database, version: TemplateVersion) {
  return tx.select().from(templateSteps).where(eq(templateSteps.templateVersionId, version.id)).orderBy(templateSteps.position)
}

async function fieldsOf(tx: Database, version: TemplateVersion) {
  return tx.select().from(templateFields).where(eq(templateFields.templateVersionId, version.id)).orderBy(templateFields.position)
}

// An organization, an admin editing in it, and a template with a published current version
async function publishedTemplate(tx: Database) {
  const organization = await createOrganization(tx)
  const context = await createMember(tx, organization, "admin")
  const template = await insertTemplate(tx, organization)
  const published = await insertTemplateVersion(tx, template, 1, "published")
  return { context, published, template: await setCurrentVersion(tx, template, published) }
}

// Resolves once some query in this database is waiting on a lock, so a test knows the second transaction has reached the contended row
async function waitForLockWait(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await db.execute(sql`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)
    if ((result.rows[0] as { waiting: number }).waiting > 0) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error("No query started waiting on a lock")
}

describe("ensureDraft", () => {
  test("returns the existing draft without creating another", async () => {
    await inRollback(async (tx) => {
      const { context, template } = await publishedTemplate(tx)
      const draft = await insertTemplateVersion(tx, template, 2, "draft")

      expect(await ensureDraft(tx, context, template.id)).toEqual(draft)
      expect(await versionsOf(tx, template.id)).toHaveLength(2)
    })
  })

  test("returns the same draft on a second call", async () => {
    await inRollback(async (tx) => {
      const { context, template } = await publishedTemplate(tx)

      const first = await ensureDraft(tx, context, template.id)
      const second = await ensureDraft(tx, context, template.id)

      expect(second.id).toBe(first.id)
      expect(await versionsOf(tx, template.id)).toHaveLength(2)
    })
  })

  test("creates an empty version 1 draft for a template with no versions", async () => {
    await inRollback(async (tx) => {
      const organization = await createOrganization(tx)
      const context = await createMember(tx, organization, "admin")
      const template = await insertTemplate(tx, organization)

      const draft = await ensureDraft(tx, context, template.id)

      expect(draft).toMatchObject({ templateId: template.id, organizationId: organization.id, version: 1, status: "draft", publishedAt: null })
      expect(await stepsOf(tx, draft)).toEqual([])
    })
  })

  test("creates the draft one version above the current version", async () => {
    await inRollback(async (tx) => {
      const { context, published, template } = await publishedTemplate(tx)

      const draft = await ensureDraft(tx, context, template.id)

      expect(draft).toMatchObject({ templateId: template.id, version: published.version + 1, status: "draft", publishedAt: null, publishedBy: null })
    })
  })

  test("numbers the draft above every existing version, not just the current one", async () => {
    await inRollback(async (tx) => {
      const { context, template } = await publishedTemplate(tx)
      await insertTemplateVersion(tx, template, 2, "archived")

      expect((await ensureDraft(tx, context, template.id)).version).toBe(3)
    })
  })

  test("copies every step's settings into the draft, in order", async () => {
    await inRollback(async (tx) => {
      const { context, published, template } = await publishedTemplate(tx)
      await insertTemplateStep(tx, published, { position: 0, title: "Check the backups", instructions: "Look at last night's job", dueOffset: "P1D" })
      await insertTemplateStep(tx, published, { position: 1, title: "Sign off", kind: "approval", isHalt: true, assigneeType: "role", assigneeRole: "admin" })

      const draft = await ensureDraft(tx, context, template.id)

      const copied = await stepsOf(tx, draft)
      expect(copied).toMatchObject([
        { position: 0, title: "Check the backups", kind: "task", instructions: "Look at last night's job", isHalt: false, skippable: false, dueOffset: "P1D", assigneeType: null },
        { position: 1, title: "Sign off", kind: "approval", isHalt: true, assigneeType: "role", assigneeRole: "admin", assigneeMemberId: null, assigneeTeamId: null },
      ])
    })
  })

  test("copies every field's settings into the draft", async () => {
    await inRollback(async (tx) => {
      const { context, published, template } = await publishedTemplate(tx)
      const step = await insertTemplateStep(tx, published)
      await insertTemplateField(tx, step, {
        position: 0,
        key: "temperature",
        label: "Temperature",
        helpText: "In degrees Celsius",
        required: false,
        type: "number",
        options: { type: "number", decimalPlaces: 1, unit: "°C" },
      })

      const draft = await ensureDraft(tx, context, template.id)

      expect(await fieldsOf(tx, draft)).toMatchObject([
        { position: 0, key: "temperature", label: "Temperature", helpText: "In degrees Celsius", required: false, type: "number", options: { type: "number", decimalPlaces: 1, unit: "°C" } },
      ])
    })
  })

  test("gives the copies new IDs and points them at the draft", async () => {
    await inRollback(async (tx) => {
      const { context, published, template } = await publishedTemplate(tx)
      const step = await insertTemplateStep(tx, published)
      const field = await insertTemplateField(tx, step)

      const draft = await ensureDraft(tx, context, template.id)

      const [copiedStep] = await stepsOf(tx, draft)
      const [copiedField] = await fieldsOf(tx, draft)
      expect(copiedStep!.id).not.toBe(step.id)
      expect(copiedStep!.id).toMatch(/^tstep_/)
      expect(copiedField!.id).not.toBe(field.id)
      expect(copiedField!.id).toMatch(/^tfield_/)
      expect(copiedField).toMatchObject({ templateVersionId: draft.id, templateStepId: copiedStep!.id })
    })
  })

  test("keeps each field on the copy of its own step", async () => {
    await inRollback(async (tx) => {
      const { context, published, template } = await publishedTemplate(tx)
      const first = await insertTemplateStep(tx, published, { position: 0, title: "First" })
      const second = await insertTemplateStep(tx, published, { position: 1, title: "Second" })
      await insertTemplateField(tx, first, { key: "first_a", position: 0 })
      await insertTemplateField(tx, first, { key: "first_b", position: 1 })
      await insertTemplateField(tx, second, { key: "second_a", position: 0 })

      const draft = await ensureDraft(tx, context, template.id)

      const steps = await stepsOf(tx, draft)
      const stepTitleById = new Map(steps.map(step => [step.id, step.title]))
      const fields = await fieldsOf(tx, draft)
      expect(fields.map(field => [field.key, stepTitleById.get(field.templateStepId)]).sort()).toEqual([
        ["first_a", "First"],
        ["first_b", "First"],
        ["second_a", "Second"],
      ])
    })
  })

  test("copies a step that has no fields", async () => {
    await inRollback(async (tx) => {
      const { context, published, template } = await publishedTemplate(tx)
      const withField = await insertTemplateStep(tx, published, { position: 0, title: "With a field" })
      await insertTemplateStep(tx, published, { position: 1, title: "Without fields" })
      await insertTemplateField(tx, withField)

      const draft = await ensureDraft(tx, context, template.id)

      expect((await stepsOf(tx, draft)).map(step => step.title)).toEqual(["With a field", "Without fields"])
      expect(await fieldsOf(tx, draft)).toHaveLength(1)
    })
  })

  test("records the editor as the creator of the draft and its copies, with new timestamps", async () => {
    await inRollback(async (tx) => {
      const { context, published, template } = await publishedTemplate(tx)
      const step = await insertTemplateStep(tx, published, { createdAt: new Date("2020-01-01T00:00:00Z") })
      await insertTemplateField(tx, step, { createdAt: new Date("2020-01-01T00:00:00Z") })

      const draft = await ensureDraft(tx, context, template.id)

      const [copiedStep] = await stepsOf(tx, draft)
      const [copiedField] = await fieldsOf(tx, draft)
      for (const row of [draft, copiedStep!, copiedField!]) {
        expect(row.createdBy).toBe(context.member.userId)
        expect(row.createdAt.getTime()).toBeGreaterThan(new Date("2020-01-01T00:00:00Z").getTime())
      }
    })
  })

  test("leaves the current version, its steps and fields, and the template unchanged", async () => {
    await inRollback(async (tx) => {
      const { context, published, template } = await publishedTemplate(tx)
      const step = await insertTemplateStep(tx, published)
      await insertTemplateField(tx, step)
      const stepsBefore = await stepsOf(tx, published)
      const fieldsBefore = await fieldsOf(tx, published)

      await ensureDraft(tx, context, template.id)

      const [versionAfter] = await tx.select().from(templateVersions).where(eq(templateVersions.id, published.id))
      const [templateAfter] = await tx.select().from(templates).where(eq(templates.id, template.id))
      expect(versionAfter).toEqual(published)
      expect(await stepsOf(tx, published)).toEqual(stepsBefore)
      expect(await fieldsOf(tx, published)).toEqual(fieldsBefore)
      expect(templateAfter).toEqual(template)
    })
  })

  test("copies an archived current version", async () => {
    await inRollback(async (tx) => {
      const organization = await createOrganization(tx)
      const context = await createMember(tx, organization, "admin")
      const inserted = await insertTemplate(tx, organization)
      const archived = await insertTemplateVersion(tx, inserted, 1, "archived")
      const template = await setCurrentVersion(tx, inserted, archived)
      await insertTemplateStep(tx, archived, { title: "Kept" })

      const draft = await ensureDraft(tx, context, template.id)

      expect(draft.version).toBe(2)
      expect((await stepsOf(tx, draft)).map(step => step.title)).toEqual(["Kept"])
    })
  })

  test("creates an empty draft above archived versions when there's no current version", async () => {
    await inRollback(async (tx) => {
      const organization = await createOrganization(tx)
      const context = await createMember(tx, organization, "admin")
      const template = await insertTemplate(tx, organization)
      const archived = await insertTemplateVersion(tx, template, 1, "archived")
      await insertTemplateStep(tx, archived)

      const draft = await ensureDraft(tx, context, template.id)

      expect(draft.version).toBe(2)
      expect(await stepsOf(tx, draft)).toEqual([])
    })
  })

  test("refuses another organization's template with not_found and creates nothing", async () => {
    await inRollback(async (tx) => {
      const { template } = await publishedTemplate(tx)
      const elsewhere = await createOrganization(tx)
      const outsider = await createMember(tx, elsewhere, "owner")

      await expect(ensureDraft(tx, outsider, template.id)).rejects.toMatchObject({ code: "not_found" })
      expect(await versionsOf(tx, template.id)).toHaveLength(1)
    })
  })

  test("refuses an ID that doesn't exist with not_found", async () => {
    await inRollback(async (tx) => {
      const organization = await createOrganization(tx)
      const context = await createMember(tx, organization, "admin")

      await expect(ensureDraft(tx, context, typeIdForTable("templates").toString())).rejects.toMatchObject({ code: "not_found" })
    })
  })

  // Uses committed rows and two connections, since the race only shows across separate transactions
  test("makes a second concurrent first edit wait and reuse the first one's draft", async () => {
    const organization = await createOrganization(db)
    const context = await createMember(db, organization, "admin")
    const template = await insertTemplate(db, organization)

    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let created!: (draft: TemplateVersion) => void
    const firstCreated = new Promise<TemplateVersion>((resolve) => {
      created = resolve
    })

    const first = db.transaction(async (tx) => {
      const draft = await ensureDraft(tx, context, template.id)
      created(draft)
      await held
      return draft
    })
    await firstCreated

    const second = db.transaction(tx => ensureDraft(tx, context, template.id))
    await waitForLockWait()
    release()

    const [firstDraft, secondDraft] = await Promise.all([first, second])
    expect(secondDraft.id).toBe(firstDraft.id)
    expect(await versionsOf(db, template.id)).toHaveLength(1)
  })
})
