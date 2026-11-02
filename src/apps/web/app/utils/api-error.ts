import { apiErrorResponseSchema } from "@checklog/shared"
import type { ApiErrorCode, ApiErrorDetail } from "@checklog/shared"

// An error response from the API, in the shape every non-auth route uses
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message)
    this.name = "ApiError"
  }

  // Bodies that don't match the format, such as a proxy's 502 page, become `internal`
  static fromResponse(status: number, body: unknown): ApiError {
    const parsed = apiErrorResponseSchema.safeParse(body)
    if (!parsed.success) {
      return new ApiError(status, "internal", "Something went wrong")
    }
    const { code, message, details } = parsed.data.error
    return new ApiError(status, code, message, details)
  }
}
