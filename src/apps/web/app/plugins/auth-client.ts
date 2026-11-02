import { createAuthClient } from "better-auth/client"
import { organizationClient } from "better-auth/client/plugins"

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
    plugins: [organizationClient({ teams: { enabled: true } })],
  })

  return { provide: { authClient } }
})
