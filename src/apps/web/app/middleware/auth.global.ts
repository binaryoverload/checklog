const signInPath = "/login"
const createOrganizationPath = "/create-organization"

// Pages are signed-in only unless they set `definePageMeta({ auth: "public" })`.
// The login path is always let through, so a missing or misconfigured page can't loop.
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.meta.auth === "public" || to.path === signInPath) return

  const { $authClient, $queryClient } = useNuxtApp()
  const session = await $queryClient.query({ ...sessionQueryOptions($authClient), staleTime: "static" })

  if (!session) {
    return navigateTo({ path: signInPath, query: { redirect: to.fullPath } })
  }

  // A not-found error rather than a redirect, so platform admin pages don't reveal that they exist
  if (to.meta.auth === "platform-admin" && !isPlatformAdmin(session.user)) {
    return abortNavigation(createError({ statusCode: 404, statusMessage: "Page not found", fatal: true }))
  }

  // Someone in no organization can only create one. The create page sets `organization: "none"`, so this can't loop.
  if (to.meta.organization !== "none") {
    const organizations = await $queryClient.query({ ...organizationsQueryOptions($authClient), staleTime: "static" })
    if (organizations.length === 0) return navigateTo(createOrganizationPath)
  }
})
