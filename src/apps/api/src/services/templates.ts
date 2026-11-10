import { and, eq, max } from "drizzle-orm"
import { omit } from "es-toolkit"

import { templateFields, templates, templateSteps, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import type { Template, TemplateVersion, Transaction, UserContext } from "@/util/types.ts"
import { typeIdForTable } from "@checklog/shared/utils"

async function lockTemplate(tx: Transaction, userContext: UserContext, templateId: string) {
  const [template] = await tx
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.organizationId, userContext.organization.id)))
    .for("update")
  if (!template) throw new HttpError("not_found", "Template not found")
  if (template.status === "archived") throw new HttpError("conflict", "Template is archived")
  return template
}

export async function ensureDraft(tx: Transaction, userContext: UserContext, templateId: string) {
  const template = await lockTemplate(tx, userContext, templateId)
  return await findDraft(tx, templateId) ?? await createDraft(tx, userContext, template)
}

export async function requireDraft(tx: Transaction, userContext: UserContext, templateId: string) {
  await lockTemplate(tx, userContext, templateId)
  const draft = await findDraft(tx, templateId)
  if (!draft) throw new HttpError("conflict", "The template has no draft; start editing it first")
  return draft
}

async function findDraft(tx: Transaction, templateId: string) {
  return await tx.select().from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.status, "draft")))
    .then(rows => rows[0] ?? null)
}

async function createDraft(tx: Transaction, userContext: UserContext, template: Template): Promise<TemplateVersion> {
  // Find the current published version of the template
  const [latestVersion] = await tx
    .select({ version: max(templateVersions.version) })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, template.id))

  const nextVersion = (latestVersion?.version ?? 0) + 1

  // Get the steps and fields of the published version, if it exists
  const [steps, fields] = template.currentVersionId
    ? await Promise.all([
        tx.select().from(templateSteps).where(eq(templateSteps.templateVersionId, template.currentVersionId)),
        tx.select().from(templateFields).where(eq(templateFields.templateVersionId, template.currentVersionId)),
      ])
    : [[], []]

  const [newDraft] = await tx
    .insert(templateVersions)
    .values({
      organizationId: userContext.organization.id,
      createdBy: userContext.member.userId,
      templateId: template.id,
      version: nextVersion,
      status: "draft",
    })
    .returning()
  if (!newDraft) throw new HttpError("internal", "Failed to create new draft version")

  const newStepIds = new Map<string, string>()
  const stepRows = steps.map((step) => {
    const newId = typeIdForTable("templateSteps").toString()
    newStepIds.set(step.id, newId)
    return {
      ...omit(step, ["id", "templateVersionId", "createdAt", "createdBy", "updatedAt"]),
      id: newId,
      templateVersionId: newDraft.id,
      createdBy: userContext.member.userId,
    }
  })

  const fieldRows = fields.map(field => ({
    ...omit(field, ["id", "templateStepId", "templateVersionId", "createdAt", "createdBy", "updatedAt"]),
    templateStepId: newStepIds.get(field.templateStepId)!,
    templateVersionId: newDraft.id,
    createdBy: userContext.member.userId,
  }))

  if (stepRows.length > 0) await tx.insert(templateSteps).values(stepRows)
  if (fieldRows.length > 0) await tx.insert(templateFields).values(fieldRows)

  return newDraft
}
