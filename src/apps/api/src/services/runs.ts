import { eq, getTableColumns } from "drizzle-orm"

import { runFieldValues, runSteps, stepNotes, templateFields, templateSteps } from "@/db/schema.ts"
import type { RunRows } from "@/mappers/runs.ts"
import type { Database, Run } from "@/util/types.ts"

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
