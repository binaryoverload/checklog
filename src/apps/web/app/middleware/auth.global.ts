const signInPath = "/login"

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
})
