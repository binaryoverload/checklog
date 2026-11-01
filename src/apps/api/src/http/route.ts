import type { Request, RequestHandler, Response } from "express"
import type { z } from "zod"

import type { ApiErrorDetail } from "@checklog/shared"

import { HttpError } from "./errors.ts"

type InputSchemas = {
  params?: z.ZodType
  query?: z.ZodType
  body?: z.ZodType
}

// The parsed values, for only the parts that have a schema
type ParsedInput<S extends InputSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.output<S[K]> : never
}

type RouteHandler<S extends InputSchemas> = (
  input: ParsedInput<S>,
  req: Request,
  res: Response,
) => void | Promise<void>

// Validates params, query and body before the handler runs, reporting every problem in one validation_failed error.
// Express 5 forwards rejected promises to the error handler, so handlers can throw.
export function route<S extends InputSchemas>(schemas: S, handler: RouteHandler<S>): RequestHandler {
  return async (req, res) => {
    const input: Record<string, unknown> = {}
    const details: ApiErrorDetail[] = []

    for (const location of ["params", "query", "body"] as const) {
      const schema = schemas[location]
      if (!schema) continue

      const result = schema.safeParse(req[location])
      if (result.success) {
        input[location] = result.data
      } else {
        for (const issue of result.error.issues) {
          details.push({
            location,
            path: issue.path.map(key => (typeof key === "number" ? key : String(key))),
            message: issue.message,
          })
        }
      }
    }

    if (details.length > 0) {
      throw new HttpError("validation_failed", "The request is invalid", details)
    }

    await handler(input as ParsedInput<S>, req, res)
  }
}
