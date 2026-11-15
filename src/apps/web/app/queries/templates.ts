import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery } from "@tanstack/vue-query"

import type { ListTemplatesQuery, Paginated, TemplateDetails, TemplateDto } from "@checklog/shared/api"

type Api = ReturnType<typeof useApi>
type TemplateListFilters = Omit<ListTemplatesQuery, "cursor">

export const templateKeys = {
  all: ["templates"] as const,
  lists: () => [...templateKeys.all, "list"] as const,
  list: (filters: TemplateListFilters) => [...templateKeys.lists(), filters] as const,
  detail: (id: string) => [...templateKeys.all, id] as const,
  draft: (id: string) => [...templateKeys.detail(id), "draft"] as const,
  versions: (id: string) => [...templateKeys.detail(id), "versions"] as const,
  version: (id: string, versionId: string) => [...templateKeys.versions(id), versionId] as const,
  access: (id: string) => [...templateKeys.detail(id), "access"] as const,
}

export const templateQueries = {
  list: (api: Api, filters: TemplateListFilters) => infiniteQueryOptions({
    queryKey: templateKeys.list(filters),
    queryFn: ({ pageParam, signal }) => api<Paginated<TemplateDto>>("/templates", { query: { ...filters, cursor: pageParam }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
  }),
  detail: (api: Api, id: string) => queryOptions({
    queryKey: templateKeys.detail(id),
    queryFn: ({ signal }) => api<TemplateDetails>(`/templates/${id}`, { signal }),
  }),
}

export function useTemplatesQuery(filters: MaybeRefOrGetter<TemplateListFilters>) {
  const api = useApi()
  const query = useInfiniteQuery(computed(() => templateQueries.list(api, toValue(filters))))
  onServerPrefetch(query.suspense)
  return query
}

export function useTemplateQuery(id: MaybeRefOrGetter<string>) {
  const api = useApi()
  const query = useQuery(computed(() => templateQueries.detail(api, toValue(id))))
  onServerPrefetch(query.suspense)
  return query
}
