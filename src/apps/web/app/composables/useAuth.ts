import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query"

type AuthClient = ReturnType<typeof useNuxtApp>["$authClient"]

// Better Auth's client returns { data, error } instead of throwing; TanStack Query needs a throw
function unwrap<T>({ data, error }: { data: T, error: { message?: string } | null }): NonNullable<T> | null {
  if (error) {
    throw new Error(error.message ?? "Authentication request failed")
  }
  return data ?? null
}

export function sessionQueryOptions(authClient: AuthClient) {
  return queryOptions({
    queryKey: ["session"],
    queryFn: async () => unwrap(await authClient.getSession()),
  })
}

// The signed-in user and session, or null when signed out
export function useSessionQuery() {
  const { $authClient } = useNuxtApp()
  const query = useQuery(sessionQueryOptions($authClient))
  onServerPrefetch(query.suspense)
  return query
}

// Organizations the signed-in user belongs to
export function useOrganizationsQuery() {
  const { $authClient } = useNuxtApp()
  const query = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => unwrap(await $authClient.organization.list()) ?? [],
  })
  onServerPrefetch(query.suspense)
  return query
}

// Everything cached belongs to the old organization, so all queries are refetched after switching
export function useSetActiveOrganization() {
  const { $authClient } = useNuxtApp()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (organizationId: string) => unwrap(await $authClient.organization.setActive({ organizationId })),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useSignOut() {
  const { $authClient } = useNuxtApp()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrap(await $authClient.signOut()),
    onSuccess: async () => {
      queryClient.clear()
      await navigateTo("/sign-in")
    },
  })
}
