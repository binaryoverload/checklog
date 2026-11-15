import { queryOptions, useQuery } from "@tanstack/vue-query"

export function membersQueryOptions(authClient: AuthClient, organizationId: string) {
  return queryOptions({
    queryKey: ["organizations", organizationId, "members"],
    queryFn: async () => unwrap(await authClient.organization.listMembers({ query: { organizationId, limit: 1000 } })),
  })
}

function useActiveOrganizationId() {
  const { data: session } = useSessionQuery()
  return computed(() => session.value?.session.activeOrganizationId ?? null)
}

export function useMembersQuery() {
  const { $authClient } = useNuxtApp()
  const organizationId = useActiveOrganizationId()
  const query = useQuery(computed(() => ({
    ...membersQueryOptions($authClient, organizationId.value ?? ""),
    enabled: organizationId.value !== null,
  })))
  onServerPrefetch(query.suspense)
  return query
}

export function useMemberQuery(userId: MaybeRefOrGetter<string>) {
  const { $authClient } = useNuxtApp()
  const organizationId = useActiveOrganizationId()
  const query = useQuery(computed(() => queryOptions({
    ...membersQueryOptions($authClient, organizationId.value ?? ""),
    enabled: organizationId.value !== null,
    select: data => data?.members.find(member => member.userId === toValue(userId)) ?? null,
  })))
  onServerPrefetch(query.suspense)
  return query
}
