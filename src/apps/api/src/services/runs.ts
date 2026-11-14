import { eq, and, getTableColumns } from "drizzle-orm"

import { templateAccessLevel, visibleRunsWhere } from "@/core/permissions.ts"
import { runFieldValues, runs, runSteps, stepNotes, templateFields, templateSteps, templateVersions } from "@/db/schema.ts"
import { HttpError } from "@/http/errors.ts"
import type { RunRows } from "@/mappers/runs.ts"
import type { Database, Run, UserContext } from "@/util/types.ts"

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
