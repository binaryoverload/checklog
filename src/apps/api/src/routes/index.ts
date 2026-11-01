import { Router } from "express"

import { approvalsRouter } from "./approvals.ts"
import { membersRouter } from "./members.ts"
import { notificationsRouter } from "./notifications.ts"
import { runsRouter } from "./runs.ts"
import { schedulesRouter } from "./schedules.ts"
import { templatesRouter } from "./templates.ts"

// One router per area, each at its full /api path. Better Auth serves /api/auth in app.ts
export function apiRouter() {
  const router = Router()

  router.use("/api/templates", templatesRouter)
  router.use("/api/runs", runsRouter)
  router.use("/api/approvals", approvalsRouter)
  router.use("/api/schedules", schedulesRouter)
  router.use("/api/notifications", notificationsRouter)
  router.use("/api/members", membersRouter)

  return router
}
