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

export function toTemplateVersionDto(_row: TemplateVersion): TemplateVersionDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toTemplateVersionDto isn't written yet")
}

export function toTemplateStepDto(_row: TemplateStep): TemplateStepDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toTemplateStepDto isn't written yet")
}

export function toTemplateFieldDto(_row: TemplateField): TemplateFieldDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toTemplateFieldDto isn't written yet")
}

export function toTemplateAccessDto(_row: TemplateAccess): TemplateAccessDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toTemplateAccessDto isn't written yet")
}
