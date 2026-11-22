import { getRequestListener } from "@hono/node-server"
import { createDashboardHandler } from "@pg-boss/dashboard/handler"

import { config } from "@/core/config.ts"

export const pgBossDashboardPath = "/api/admin/jobs"

// Hardcode the dashboard to be read-only
process.env.PGBOSS_DASHBOARD_READ_ONLY = "1"

export const pgBossDashboard = createDashboardHandler({
  databases: [{ url: config.DATABASE_URL, name: "Checklog" }],
  basePath: pgBossDashboardPath,
  siteUrl: new URL(config.PUBLIC_URL).origin,
})

export const pgBossDashboardListener = getRequestListener(pgBossDashboard)
