import { asc, desc, eq } from "drizzle-orm"

import { db } from "@/db/index.ts"
import { templateFields, templates, templateSteps, templateVersions } from "@/db/schema.ts"
import type { Organization, Template, TemplateStep, TemplateVersion } from "@/util/types.ts"
import { typeIdForTable } from "@checklog/shared/utils"
import { insertTemplate, insertTemplateField, insertTemplateStep, insertTemplateVersion, setCurrentVersion } from "@test/support/database.ts"

// A template whose draft has steps with these titles, at positions 0 to n−1
export async function draftWithSteps(organization: Organization, titles: string[] = [], options: { createdBy?: string } = {}) {
  const template = await insertTemplate(db, organization, options)
  const draft = await insertTemplateVersion(db, template, 1, "draft")
  const steps: TemplateStep[] = []
  for (const [position, title] of titles.entries()) steps.push(await insertTemplateStep(db, draft, { title, position }))
  return { template, draft, steps }
}

// A template with a published current version holding these steps, and no draft
export async function publishedWithSteps(organization: Organization, titles: string[]) {
  const inserted = await insertTemplate(db, organization)
  const published = await insertTemplateVersion(db, inserted, 1, "published")
  const template = await setCurrentVersion(db, inserted, published)
  const steps: TemplateStep[] = []
  for (const [position, title] of titles.entries()) steps.push(await insertTemplateStep(db, published, { title, position }))
  return { template, published, steps }
}

// A template with a published current version 1 and a version 2 draft holding these steps
export async function publishedWithDraft(organization: Organization, titles: string[] = []) {
  const { template, published } = await publishedWithSteps(organization, ["Published"])
  const draft = await insertTemplateVersion(db, template, 2, "draft")
  const steps: TemplateStep[] = []
  for (const [position, title] of titles.entries()) steps.push(await insertTemplateStep(db, draft, { title, position }))
  return { template, published, draft, steps }
}

export async function stepsOf(version: TemplateVersion) {
  return db.select().from(templateSteps).where(eq(templateSteps.templateVersionId, version.id)).orderBy(asc(templateSteps.position))
}

export async function titlesOf(version: TemplateVersion) {
  return (await stepsOf(version)).map(step => step.title)
}

export async function fieldsOf(step: TemplateStep) {
  return db.select().from(templateFields).where(eq(templateFields.templateStepId, step.id)).orderBy(asc(templateFields.position))
}

export async function keysOf(step: TemplateStep) {
  return (await fieldsOf(step)).map(field => field.key)
}

export async function versionsOf(template: Template) {
  return db.select().from(templateVersions).where(eq(templateVersions.templateId, template.id)).orderBy(asc(templateVersions.version))
}

export async function storedTemplate(templateId: string) {
  const [row] = await db.select().from(templates).where(eq(templates.id, templateId))
  return row!
}

export async function storedVersion(versionId: string) {
  const [row] = await db.select().from(templateVersions).where(eq(templateVersions.id, versionId))
  return row
}

export async function storedStep(stepId: string) {
  const [row] = await db.select().from(templateSteps).where(eq(templateSteps.id, stepId))
  return row
}

export async function storedField(fieldId: string) {
  const [row] = await db.select().from(templateFields).where(eq(templateFields.id, fieldId))
  return row
}

// Gives the access tests a draft to edit, when the template exists
export async function draftIn(templateId: string) {
  const [template] = await db.select().from(templates).where(eq(templates.id, templateId))
  return template ? insertTemplateVersion(db, template, 1, "draft") : undefined
}

// Gives the access tests a step in the template's draft, or an unused step ID when the template doesn't exist
export async function draftStepIn(templateId: string) {
  const draft = await draftIn(templateId)
  if (!draft) return { id: typeIdForTable("templateSteps").toString(), updatedAt: new Date() }
  return insertTemplateStep(db, draft)
}

// Gives the access tests a field on a step in the template's draft, or an unused field ID when the template doesn't exist
export async function draftFieldIn(templateId: string) {
  const draft = await draftIn(templateId)
  if (!draft) return { id: typeIdForTable("templateFields").toString(), updatedAt: new Date() }
  return insertTemplateField(db, await insertTemplateStep(db, draft))
}

// The newest version of a template, or an unused version ID when the template doesn't exist
export async function latestVersionIdOf(templateId: string) {
  const [row] = await db.select({ id: templateVersions.id }).from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.version))
  return row?.id ?? typeIdForTable("templateVersions").toString()
}
