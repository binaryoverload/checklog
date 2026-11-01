import z from "zod"

// The body of every API error response, except Better Auth's routes under /api/auth

export const apiErrorCodes = [
  "bad_request",
  "invalid_json",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "no_active_organization",
  "organization_deleted",
  "not_found",
  "conflict",
  "payload_too_large",
  "internal",
] as const
export const apiErrorCodeSchema = z.enum(apiErrorCodes)
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

// One problem with a request's input, on validation_failed only
export const apiErrorDetailSchema = z.object({
  location: z.enum(["params", "query", "body"]),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
})
export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.array(apiErrorDetailSchema).optional(),
  }),
})
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>
