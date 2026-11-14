import { groupBy, keyBy, sortBy } from "es-toolkit"

import { toTemplateFieldDto, toTemplateStepDto } from "@/mappers/templates.ts"
import type { Run, RunFieldValue, RunStep, StepNote, TemplateField, TemplateStep } from "@/util/types.ts"
import type { RunDto, RunFieldWithValueDto, RunStepDto, RunStepWithDetailsDto, RunWithDetailsDto, StepNoteDto } from "@checklog/shared/api"
import { blockedStepIds, flatToAssignee } from "@checklog/shared/domain"

// Everything a run's details are built from, loaded by the route
export interface RunRows {
  run: Run
  templateId: string
  templateSteps: TemplateStep[]
  templateFields: TemplateField[]
  runSteps: RunStep[]
  runStepNotes: StepNote[]
  runFieldValues: RunFieldValue[]
}

export function toRunDto(row: Run, templateId: string): RunDto {
  return {
    id: row.id,
    templateId,
    templateVersionId: row.templateVersionId,
    scheduleId: row.scheduleId,
    name: row.name,
    status: row.status,
    timezone: row.timezone,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toRunWithDetailsDto(rows: RunRows): RunWithDetailsDto {
  const templateStepsById = keyBy(rows.templateSteps, step => step.id)
  const fieldsByStep = groupBy(rows.templateFields, field => field.templateStepId)
  const valuesByStep = groupBy(rows.runFieldValues, value => value.runStepId)
  const notesByStep = groupBy(rows.runStepNotes, note => note.runStepId)

  // Run steps in template order; each needs its template step for the position and halt flag
  const ordered = sortBy(
    rows.runSteps.map(step => ({ step, templateStep: templateStepsById[step.templateStepId]! })),
    [({ templateStep }) => templateStep.position],
  )

  const blockedSteps = blockedStepIds(ordered.map(({ step, templateStep }) => ({ id: step.id, isHalt: templateStep.isHalt, status: step.status })))
  const steps = ordered.map(({ step, templateStep }) => {
    const dto = toRunStepWithDetailsDto(
      step,
      templateStep,
      fieldsByStep[templateStep.id] ?? [],
      valuesByStep[step.id] ?? [],
      notesByStep[step.id] ?? [],
      blockedSteps.has(step.id),
    )
    return dto
  })

  return { ...toRunDto(rows.run, rows.templateId), steps }
}

export function toRunStepDto(row: RunStep): RunStepDto {
  const assignee = flatToAssignee(row)

  return {
    id: row.id,
    runId: row.runId,
    templateStepId: row.templateStepId,
    status: row.status,
    assignee,
    assigneeMissing: row.assigneeType != null && assignee == null,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy,
    skipReason: row.skipReason,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toRunStepWithDetailsDto(
  row: RunStep,
  templateStep: TemplateStep,
  fields: TemplateField[],
  values: RunFieldValue[],
  notes: StepNote[],
  blocked: boolean,
): RunStepWithDetailsDto {
  const valuesByField = keyBy(values, value => value.templateFieldId)

  return {
    ...toRunStepDto(row),
    blocked,
    templateStep: toTemplateStepDto(templateStep),
    fields: sortBy(fields, ["position"]).map(field => toRunFieldWithValueDto(field, valuesByField[field.id])),
    notes: sortBy(notes, ["createdAt", "id"]).map(toStepNoteDto),
  }
}

export function toRunFieldWithValueDto(field: TemplateField, value: RunFieldValue | undefined): RunFieldWithValueDto {
  return {
    ...toTemplateFieldDto(field),
    value: value?.value ?? null,
    valueUpdatedBy: value?.updatedBy ?? null,
    valueUpdatedAt: value?.updatedAt.toISOString() ?? null,
  }
}

export function toStepNoteDto(row: StepNote): StepNoteDto {
  return {
    id: row.id,
    runStepId: row.runStepId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  }
}
