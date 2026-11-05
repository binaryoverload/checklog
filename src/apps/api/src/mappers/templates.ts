import type { Template } from "@/util/types.ts"
import type { TemplateDto } from "@checklog/shared/api"

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
