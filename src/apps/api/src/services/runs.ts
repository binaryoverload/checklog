import { eq, and, getTableColumns, inArray } from "drizzle-orm"

import { templateAccessLevel, visibleRunsWhere } from "@/core/permissions.ts"
import { members, teams } from "@/db/auth-schema.ts"
import { runFieldValues, runs, runSteps, stepNotes, templateFields, templateSteps, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import type { RunRows } from "@/mappers/runs.ts"
import type { Database, Run, Template, UserContext } from "@/util/types.ts"
import { flatToAssignee, missingAssigneeIssues } from "@checklog/shared/domain"
import type { PreconditionIssue } from "@checklog/shared/domain"

export async function loadRunRows(tx: Database, run: Run, templateId: string): Promise<RunRows> {
  const templateStepsResult = await tx.select().from(templateSteps)
    .where(eq(templateSteps.templateVersionId, run.templateVersionId))

  const templateFieldsResult = await tx.select().from(templateFields)
    .where(eq(templateFields.templateVersionId, run.templateVersionId))

  const runStepResult = await tx.select().from(runSteps)
    .where(eq(runSteps.runId, run.id))

  const runStepNotesResult = await tx.select(getTableColumns(stepNotes)).from(stepNotes)
    .innerJoin(runSteps, eq(stepNotes.runStepId, runSteps.id))
    .where(eq(runSteps.runId, run.id))

  const runFieldValuesResult = await tx.select(getTableColumns(runFieldValues)).from(runFieldValues)
    .innerJoin(runSteps, eq(runFieldValues.runStepId, runSteps.id))
    .where(eq(runSteps.runId, run.id))

  return {
    run,
    templateId,
    templateSteps: templateStepsResult,
    templateFields: templateFieldsResult,
    runSteps: runStepResult,
    runStepNotes: runStepNotesResult,
    runFieldValues: runFieldValuesResult,
  }
}

export async function lockRun(tx: Database, runId: string, context: UserContext) {
  const [row] = await tx.select({ run: runs, templateId: templateVersions.templateId }).from(runs)
    .innerJoin(templateVersions, eq(templateVersions.id, runs.templateVersionId))
    .where(and(eq(runs.id, runId), visibleRunsWhere(context)))
    .for("update", { of: runs })
  if (!row) throw new HttpError("not_found", "Run not found")
  const accessLevel = await templateAccessLevel(tx, context, row.templateId)
  return {
    run: row.run,
    templateId: row.templateId,
    templateAccessLevel: accessLevel,
  }
}

export async function runStartIssues(tx: Database, template: Template): Promise<PreconditionIssue[]> {
  const issues: PreconditionIssue[] = []
  if (template.status === "archived") {
    issues.push({ location: "resource", resourceType: "template", templateId: template.id, problem: "template_archived", message: "Template is archived" })
    return issues
  }
  if (template.currentVersionId == null) {
    issues.push({ location: "resource", resourceType: "template", templateId: template.id, problem: "no_current_version", message: "Template has no current version" })
    return issues
  }
  const [currentVersion] = await tx.select().from(templateVersions).where(eq(templateVersions.id, template.currentVersionId))
  // Shouldn't be possible due to FKs, but for typesafety
  if (!currentVersion) throw new HttpError("internal", "Current version not found")

  if (currentVersion.status === "archived") {
    issues.push({ location: "resource", resourceType: "templateVersion", problem: "version_archived", versionId: currentVersion.id, message: "The current version is archived" })
  }

  const steps = await tx.select().from(templateSteps).where(eq(templateSteps.templateVersionId, currentVersion.id))
  issues.push(...missingAssigneeIssues(steps.map(row => ({ ...row, assignee: flatToAssignee(row) }))))

  const memberIds = steps.map(step => step.assigneeMemberId).filter(id => id != null)
  const teamIds = steps.map(step => step.assigneeTeamId).filter(id => id != null)
  const validMembers = memberIds.length === 0
    ? []
    : await tx.select({ id: members.id }).from(members).where(and(
        eq(members.organizationId, template.organizationId),
        inArray(members.id, memberIds),
      ))
  const validTeams = teamIds.length === 0
    ? []
    : await tx.select({ id: teams.id }).from(teams).where(and(
        eq(teams.organizationId, template.organizationId),
        inArray(teams.id, teamIds),
      ))
  const validMemberIds = new Set(validMembers.map(row => row.id))
  const validTeamIds = new Set(validTeams.map(row => row.id))

  for (const step of steps) {
    if (step.assigneeMemberId != null && !validMemberIds.has(step.assigneeMemberId)) {
      issues.push({
        location: "resource",
        resourceType: "templateStep",
        problem: "assignee_outside_organization",
        stepId: step.id,
        fieldId: null,
        message: "The step's assigned member isn't in this organization",
      })
    }
    if (step.assigneeTeamId != null && !validTeamIds.has(step.assigneeTeamId)) {
      issues.push({
        location: "resource",
        resourceType: "templateStep",
        problem: "assignee_outside_organization",
        stepId: step.id,
        fieldId: null,
        message: "The step's assigned group isn't in this organization",
      })
    }
  }

  return issues
}
