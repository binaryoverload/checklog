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
})
