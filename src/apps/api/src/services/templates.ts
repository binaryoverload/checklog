import { and, eq, max } from "drizzle-orm"
import { omit } from "es-toolkit"

import { templateFields, templates, templateSteps, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import type { TemplateVersion, Transaction, UserContext } from "@/util/types.ts"
import { typeIdForTable } from "@checklog/shared/utils"

export async function ensureDraft(tx: Transaction, userContext: UserContext, templateId: string): Promise<TemplateVersion> {
  const fromOrg = eq(templates.organizationId, userContext.organization.id)

  const [template] = await tx
    .select({ id: templates.id, status: templates.status, currentVersionId: templates.currentVersionId })
    .from(templates)
    .where(and(eq(templates.id, templateId), fromOrg))
    .for("update")

  if (!template) throw new HttpError("not_found", "Template not found")
  if (template.status === "archived") throw new HttpError("conflict", "Template is archived")

  const draft = await tx.query.templateVersions.findFirst({
    where: (v, { and, eq }) => and(eq(v.templateId, templateId), eq(v.status, "draft")),
  })
  // If we already have a draft, use that
  if (draft) return draft

  // Find the current published version of the template
  const [latestVersion] = await tx
    .select({ version: max(templateVersions.version) })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))

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
      templateId,
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
