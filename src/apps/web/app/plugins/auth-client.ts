import { createAuthClient } from "better-auth/client"
import { adminClient, organizationClient } from "better-auth/client/plugins"

import { orgAccessControl, orgRoles, platformAccessControl, platformRoles } from "@checklog/shared"

// One Better Auth client per request on the server, so each carries that visitor's cookie.
// Session state lives in TanStack Query (see useSessionQuery), not in Better Auth's own stores.
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  const authClient = createAuthClient({
    baseURL: import.meta.server ? config.apiInternalUrl : window.location.origin,
    basePath: "/api/auth",
    fetchOptions: {
      headers: import.meta.server ? useRequestHeaders(["cookie"]) : undefined,
    },
    plugins: [
      adminClient({ ac: platformAccessControl, roles: platformRoles }),
      organizationClient({
        ac: orgAccessControl,
        roles: orgRoles,
        teams: { enabled: true },
      }),
    ],
  })

  return { provide: { authClient } }
})
