import type { Template, TemplateAccess, TemplateField, TemplateStep, TemplateVersion } from "@/util/types.ts"
import type { TemplateAccessDto, TemplateDto, TemplateFieldDto, TemplateStepDto, TemplateVersionDto } from "@checklog/shared/api"

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

export function toTemplateStepDto(row: TemplateStep): TemplateStepDto {
  return {
    id: row.id,
    templateVersionId: row.templateVersionId,
    kind: row.kind,
    position: row.position,
    title: row.title,
    instructions: row.instructions,
    isHalt: row.isHalt,
    skippable: row.skippable,
    assigneeType: row.assigneeType,
    assigneeMemberId: row.assigneeMemberId,
    assigneeTeamId: row.assigneeTeamId,
    assigneeRole: row.assigneeRole,
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
