import { sortBy } from "es-toolkit"

import type { ApprovalDecision, ApprovalRequest } from "@/util/types.ts"
import type { ApprovalDecisionDto, ApprovalRequestDetailDto, ApprovalRequestDto } from "@checklog/shared/api"

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

type ApprovalRequestDetail = ApprovalRequest & { run: { id: string, name: string }, step: { id: string, title: string } }
export function toApprovalRequestDetailDto(request: ApprovalRequestDetail, decisions: ApprovalDecision[]): ApprovalRequestDetailDto {
  return {
    ...toApprovalRequestDto(request, decisions),
    run: request.run,
    step: request.step,
  }
}
