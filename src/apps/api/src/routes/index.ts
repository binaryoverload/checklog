import { Router } from "express"

import { approvalsRouter } from "@/routes/approvals.ts"
import { membersRouter } from "@/routes/members.ts"
import { notificationsRouter } from "@/routes/notifications.ts"
import { runStepsRouter } from "@/routes/run-steps.ts"
import { runsRouter } from "@/routes/runs.ts"
import { schedulesRouter } from "@/routes/schedules.ts"
import { templateAccessRouter } from "@/routes/template-access.ts"
import { templateDraftsRouter } from "@/routes/template-drafts.ts"
import { templateFieldsRouter } from "@/routes/template-fields.ts"
import { templatesRouter } from "@/routes/templates.ts"

// One router per area, each at its full /api path. Better Auth serves /api/auth in app.ts
export function apiRouter() {
  const router = Router()

  router.use("/api/templates", templatesRouter)
  router.use("/api/templates", templateDraftsRouter)
  router.use("/api/templates", templateAccessRouter)
  router.use("/api/templates", templateFieldsRouter)

  router.use("/api/runs", runsRouter)
  router.use("/api/runs", runStepsRouter)

  router.use("/api/approvals", approvalsRouter)
  router.use("/api/schedules", schedulesRouter)
  router.use("/api/notifications", notificationsRouter)
  router.use("/api/members", membersRouter)

  return router
}
