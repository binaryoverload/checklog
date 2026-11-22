import { fromNodeHeaders } from "better-auth/node"
import type { RequestHandler } from "express"

import { auth } from "@/core/auth.ts"
import { HttpError } from "@/http/errors.ts"
import { isPlatformAdmin } from "@checklog/shared/auth"

export const platformAdminGuard: RequestHandler = async (req, res, next) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  })
  if (!session) return next(new HttpError("unauthorized", "Unauthorized"))
  if (!isPlatformAdmin(session.user)) return next(new HttpError("forbidden", "Forbidden"))
  return next()
}
