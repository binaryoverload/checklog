import { sortBy } from "es-toolkit"

import type { ApprovalDecision, ApprovalRequest } from "@/util/types.ts"
import type { ApprovalDecisionDto, ApprovalRequestDto } from "@checklog/shared/api"

export function toApprovalRequestDto(request: ApprovalRequest, decisions: ApprovalDecision[]): ApprovalRequestDto {
  return {
    id: request.id,
    runStepId: request.runStepId,
    status: request.status,
    decisions: sortBy(decisions, ["createdAt", "id"]).map(toApprovalDecisionDto),
    createdAt: request.createdAt.toISOString(),
    createdBy: request.createdBy,
    updatedAt: request.updatedAt.toISOString(),
  }
}

export function toApprovalDecisionDto(decision: ApprovalDecision): ApprovalDecisionDto {
  return {
    id: decision.id,
    decision: decision.decision,
    comment: decision.comment,
    createdAt: decision.createdAt.toISOString(),
    createdBy: decision.createdBy,
  }
}
