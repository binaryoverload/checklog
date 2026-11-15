import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query"

import { memberCan } from "@checklog/shared/auth"
import type { OrgStatementsCheckInput } from "@checklog/shared/auth"

export type AuthClient = ReturnType<typeof useNuxtApp>["$authClient"]

// Better Auth's client returns { data, error } instead of throwing; TanStack Query needs a throw
export function unwrap<T>({ data, error }: { data: T, error: { message?: string } | null }): NonNullable<T> | null {
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

export function organizationsQueryOptions(authClient: AuthClient) {
  return queryOptions({
    queryKey: ["organizations"],
    queryFn: async () => unwrap(await authClient.organization.list()) ?? [],
  })
}

// Organizations the signed-in user belongs to
export function useOrganizationsQuery() {
  const { $authClient } = useNuxtApp()
  const query = useQuery(organizationsQueryOptions($authClient))
  onServerPrefetch(query.suspense)
  return query
}

export function useActiveOrganization() {
  const { data: organizations } = useOrganizationsQuery()
  const { data: session } = useSessionQuery()
  return computed(() => organizations.value?.find(org => org.id === session.value?.session.activeOrganizationId) ?? null)
}

export function activeMemberQueryOptions(authClient: AuthClient, organizationId: string) {
  return queryOptions({
    queryKey: ["organizations", organizationId, "activeMember"],
    queryFn: async () => unwrap(await authClient.organization.getActiveMember()),
  })
}

export function useActiveMemberQuery() {
  const { $authClient } = useNuxtApp()
  const organization = useActiveOrganization()
  const query = useQuery(computed(() => queryOptions({
    ...activeMemberQueryOptions($authClient, organization.value?.id ?? ""),
    enabled: !!organization.value?.id,
  })))
  onServerPrefetch(query.suspense)
  return query
}

// Everything cached belongs to the old organization, so all queries are refetched after switching
export function useSetActiveOrganization() {
  const { $authClient } = useNuxtApp()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (organizationId: string | null) => unwrap(await $authClient.organization.setActive({ organizationId })),
    onSuccess: () => queryClient.resetQueries(),
  })
}

export function useSignOut() {
  const { $authClient } = useNuxtApp()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrap(await $authClient.signOut()),
    onSuccess: async () => {
      queryClient.clear()
      await navigateTo("/login")
    },
  })
}

export function useAuth() {
  const { $authClient } = useNuxtApp()
  return $authClient
}

export function useCan() {
  const { data: member } = useActiveMemberQuery()
  return (permissions: OrgStatementsCheckInput) => member.value ? memberCan(member.value, permissions) : false
}
