import { asc, eq, and, getTableColumns, inArray, lt } from "drizzle-orm"
import type { IANAZone } from "luxon"

import { canActOnStep, getMemberTeamIds, templateAccessLevel, visibleRunsWhere } from "@/core/permissions.ts"
import { members, teams } from "@/db/auth-schema.ts"
import { runFieldValues, runs, runSteps, stepNotes, templateFields, templateSteps, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import type { RunRows } from "@/mappers/runs.ts"
import type { Database, Run, Template, TemplateStep, UserContext } from "@/util/types.ts"
import { allStepsResolved, flatToAssignee, missingAssigneeIssues, templateAccessIncludes } from "@checklog/shared/domain"
import type { PreconditionIssue } from "@checklog/shared/domain"
import { addOffset } from "@checklog/shared/utils"

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

export async function startRun(tx: Database, data: { template: Template, createdBy: string, timezone: IANAZone<true>, name?: string, scheduleId: string | null }) {
  const { template, timezone } = data

  if (!template.currentVersionId) throw new HttpError("internal", "No current version")

  const [run] = await tx.insert(runs).values({
    organizationId: template.organizationId,
    templateVersionId: template.currentVersionId,
    scheduleId: data.scheduleId,
    name: data.name ?? template.name,
    timezone: timezone.name,
    status: "in_progress",
    createdBy: data.createdBy,
  }).returning()
  if (!run) throw new HttpError("internal", "Failed to create run")

  const steps = await tx.select().from(templateSteps)
    .where(eq(templateSteps.templateVersionId, template.currentVersionId))
    .orderBy(asc(templateSteps.position))

  if (steps.length > 0) {
    await tx.insert(runSteps).values(steps.map(step => ({
      organizationId: template.organizationId,
      runId: run.id,
      templateVersionId: step.templateVersionId,
      templateStepId: step.id,
      status: "pending" as const,
      assigneeType: step.assigneeType,
      assigneeMemberId: step.assigneeMemberId,
      assigneeTeamId: step.assigneeTeamId,
      assigneeRole: step.assigneeRole,
      dueAt: step.dueOffset ? addOffset(run.createdAt, step.dueOffset, timezone) : null,
      createdBy: data.createdBy,
    })))
  }

  return run
}

type StepAccess = "assignee" | "view" | "run"
export async function requireRunStep(tx: Database, context: UserContext, runId: string, stepId: string, access: StepAccess) {
  const { run, templateId, templateAccessLevel } = await lockRun(tx, runId, context)

  const [row] = await tx.select({ step: runSteps, templateStep: templateSteps }).from(runSteps)
    .innerJoin(templateSteps, eq(templateSteps.id, runSteps.templateStepId))
    .where(and(eq(runSteps.runId, runId), eq(runSteps.id, stepId)))
  if (!row) throw new HttpError("not_found", "Step not found")

  let allowed
  if (access === "assignee") {
    allowed = canActOnStep(row.step, context.member, await getMemberTeamIds(tx, context), templateAccessLevel)
  } else if (access === "run") {
    allowed = templateAccessLevel != null && templateAccessIncludes(templateAccessLevel, "run")
  } else {
    // lockRun already checks for visibility
    allowed = true
  }

  if (!allowed) throw new HttpError("forbidden", "You can't act on this step")

  return { run, templateId, ...row, templateAccessLevel }
}

export async function completeRunIfResolved(tx: Database, run: Run) {
  const steps = await tx.select({ status: runSteps.status }).from(runSteps).where(eq(runSteps.runId, run.id))

  if (allStepsResolved(steps)) {
    const [updatedRun] = await tx.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, run.id)).returning()
    if (!updatedRun) throw new HttpError("internal", "Failed to update run")
    return updatedRun
  }

  return run
}

export async function assertNoPendingHaltBefore(tx: Database, run: Run, templateStep: TemplateStep) {
  const pendingHalts = await tx.select({ id: runSteps.id }).from(runSteps)
    .innerJoin(templateSteps, eq(templateSteps.id, runSteps.templateStepId))
    .where(and(
      eq(runSteps.runId, run.id),
      lt(templateSteps.position, templateStep.position),
      eq(templateSteps.isHalt, true),
      eq(runSteps.status, "pending"),
    ))

  if (pendingHalts.length) throw new HttpError("precondition_failed", "Step is blocked", pendingHalts.map(halt => ({
    location: "resource",
    resourceType: "runStep",
    problem: "halt_step_not_completed",
    stepId: halt.id,
    fieldId: null,
    message: "A halt step before this one isn't done",
  })))
}
