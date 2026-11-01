import type { ErrorRequestHandler, RequestHandler, Response } from "express"

import type { ApiErrorResponse } from "@checklog/shared"

import { HttpError } from "./errors.ts"
import { logger } from "../core/logger.ts"

export const notFound: RequestHandler = (req) => {
  const path = req.originalUrl.split("?")[0]
  throw new HttpError("not_found", `No route for ${req.method} ${path}`)
}

function send(res: Response, error: HttpError) {
  const body: ApiErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  }
  res.status(error.status).json(body)
}

// Errors from express.json() (body-parser) carry a `type` and a client-safe `expose` flag
function bodyParserError(error: unknown): HttpError | undefined {
  if (typeof error !== "object" || error === null || !("type" in error)) return undefined
  if (error.type === "entity.parse.failed") {
    return new HttpError("invalid_json", "The request body is not valid JSON")
  }
  if (error.type === "entity.too.large") {
    return new HttpError("payload_too_large", "The request body is too large")
  }
  if ("expose" in error && error.expose === true && error instanceof Error) {
    return new HttpError("bad_request", error.message)
  }
  return undefined
}

// Unexpected errors are logged and get a generic 500, so internals never reach the client.
// Express only treats this as an error handler because it takes all four parameters.
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error)
    return
  }

  if (error instanceof HttpError) {
    send(res, error)
    return
  }

  const clientError = bodyParserError(error)
  if (clientError) {
    send(res, clientError)
    return
  }

  const path = req.originalUrl.split("?")[0]
  logger.error(`Unhandled error on ${req.method} ${path}`, error)
  send(res, new HttpError("internal", "Something went wrong"))
}
