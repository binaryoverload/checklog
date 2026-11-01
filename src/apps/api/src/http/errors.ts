import type { ApiErrorCode, ApiErrorDetail } from "@checklog/shared"

const statusByCode: Record<ApiErrorCode, number> = {
  bad_request: 400,
  invalid_json: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  no_active_organization: 403,
  organization_deleted: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  internal: 500,
}

// The message is sent to the client, so keep internals out of it.
export class HttpError extends Error {
  readonly status: number

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message)
    this.name = "HttpError"
    this.status = statusByCode[code]
  }
}
