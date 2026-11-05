import type { ApprovalDecision, ApprovalRequest } from "@/util/types.ts"
import type { ApprovalDecisionDto, ApprovalRequestDto } from "@checklog/shared/api"

export function toApprovalRequestDto(_row: ApprovalRequest): ApprovalRequestDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toApprovalRequestDto isn't written yet")
}

export function toApprovalDecisionDto(_row: ApprovalDecision): ApprovalDecisionDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toApprovalDecisionDto isn't written yet")
}
