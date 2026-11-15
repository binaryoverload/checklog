import { sortBy } from "es-toolkit"

import type { Template, TemplateAccess, TemplateField, TemplateStep, TemplateVersion } from "@/util/types.ts"
import type { TemplateAccessDto, TemplateAccessWithNameDto, TemplateDetailsDto, TemplateDto, TemplateFieldDto, TemplateListItemDto, TemplateStepDto, TemplateStepWithFieldsDto, TemplateVersionDto, TemplateVersionWithStepsDto } from "@checklog/shared/api"
import { flatToAssignee } from "@checklog/shared/domain"
import type { TemplateAccessLevel } from "@checklog/shared/domain"

export function toTemplateDto(row: Template): TemplateDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    currentVersionId: row.currentVersionId,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toTemplateDetailsDto(
  row: Template,
  currentVersion: TemplateVersion | null,
  draftVersion: TemplateVersion | null,
  accessLevel: TemplateAccessLevel,
): TemplateDetailsDto {
  return {
    ...toTemplateDto(row),
    currentVersion: currentVersion ? toTemplateVersionDto(currentVersion) : null,
    draftVersion: draftVersion ? toTemplateVersionDto(draftVersion) : null,
    accessLevel,
  }
}

export function toTemplateListItemDto(
  row: Template,
  currentVersion: { id: string, version: number, stepCount: number } | null,
  draftVersion: { id: string, version: number } | null,
  accessLevel: TemplateAccessLevel,
): TemplateListItemDto {
  return {
    ...toTemplateDto(row),
    currentVersion: currentVersion ? { id: currentVersion.id, version: currentVersion.version, stepCount: currentVersion.stepCount } : null,
    draftVersion: draftVersion ? { id: draftVersion.id, version: draftVersion.version } : null,
    accessLevel,
  }
}

export function toTemplateVersionDto(row: TemplateVersion): TemplateVersionDto {
  return {
    id: row.id,
    templateId: row.templateId,
    version: row.version,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedBy: row.publishedBy,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toTemplateVersionWithStepsDto(version: TemplateVersion, steps: TemplateStep[], fields: TemplateField[]): TemplateVersionWithStepsDto {
  return {
    ...toTemplateVersionDto(version),
    steps: sortBy(steps.map(step => toTemplateStepWithFieldsDto(step, fields.filter(field => field.templateStepId === step.id))), ["position"]),
  }
}

export function toTemplateStepWithFieldsDto(step: TemplateStep, fields: TemplateField[]): TemplateStepWithFieldsDto {
  return {
    ...toTemplateStepDto(step),
    fields: sortBy(fields.map(toTemplateFieldDto), ["position"]),
  }
}

export function toTemplateStepDto(row: TemplateStep): TemplateStepDto {
  const assignee = flatToAssignee(row)

  return {
    id: row.id,
    templateVersionId: row.templateVersionId,
    kind: row.kind,
    position: row.position,
    title: row.title,
    instructions: row.instructions,
    isHalt: row.isHalt,
    skippable: row.skippable,
    assignee,
    // If the assignee type is set but the ID is null, the assignee target has been removed
    assigneeMissing: row.assigneeType != null && assignee == null,
    dueOffset: row.dueOffset,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toTemplateFieldDto(row: TemplateField): TemplateFieldDto {
  return {
    id: row.id,
    templateVersionId: row.templateVersionId,
    templateStepId: row.templateStepId,
    position: row.position,
    required: row.required,
    key: row.key,
    label: row.label,
    helpText: row.helpText,
    type: row.type,
    options: row.options,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toTemplateAccessDto(row: TemplateAccess): TemplateAccessDto {
  return {
    id: row.id,
    templateId: row.templateId,
    memberId: row.memberId,
    teamId: row.teamId,
    level: row.level,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toTemplateAccessWithNameDto(row: TemplateAccess, name: string): TemplateAccessWithNameDto {
  return {
    ...toTemplateAccessDto(row),
    name,
  }
}
