import type { RequestHandler } from "express"

import { logger } from "@/core/logger.ts"

export const requestLogging: RequestHandler = (req, res, next) => {
  const start = performance.now()

  res.on("close", () => {
    // Leave out the query string: it can carry tokens (password reset, email verification)
    const path = req.originalUrl.split("?")[0]
    logger.http(`${req.method} ${path}`, {
      status: res.statusCode,
      durationMs: Math.round(performance.now() - start),
      // The client went away before the response finished
      ...(res.writableFinished ? {} : { aborted: true }),
    })
  })

  next()
}
