import { infiniteQueryOptions, queryOptions, skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query"

import type { TemplateAccessWithNameDto, ListTemplatesQuery, Paginated, TemplateDetailsDto, TemplateVersionDto, TemplateVersionWithStepsDto, TemplateListItemDto, CreateTemplateBody, TemplateDto, UpdateTemplateBody } from "@checklog/shared/api"

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
    queryFn: ({ pageParam, signal }) => api<Paginated<TemplateListItemDto>>("/templates", { query: { ...filters, cursor: pageParam }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
  }),
  detail: (api: Api, id: string) => queryOptions({
    queryKey: templateKeys.detail(id),
    queryFn: ({ signal }) => api<TemplateDetailsDto>(`/templates/${id}`, { signal }),
  }),
  versions: (api: Api, id: string) => queryOptions({
    queryKey: templateKeys.versions(id),
    queryFn: ({ signal }) => api<TemplateVersionDto[]>(`/templates/${id}/versions`, { signal }),
  }),
  version: (api: Api, id: string, versionId: string | null | undefined) => queryOptions({
    queryKey: templateKeys.version(id, versionId ?? ""),
    queryFn: versionId
      ? ({ signal }) => api<TemplateVersionWithStepsDto>(`/templates/${id}/versions/${versionId}`, { signal })
      : skipToken,
  }),
  draft: (api: Api, id: string) => queryOptions({
    queryKey: templateKeys.draft(id),
    queryFn: ({ signal }) => api<TemplateVersionWithStepsDto>(`/templates/${id}/draft`, { signal }),
  }),
  access: (api: Api, id: string) => queryOptions({
    queryKey: templateKeys.access(id),
    queryFn: ({ signal }) => api<TemplateAccessWithNameDto[]>(`/templates/${id}/access`, { signal }),
  }),
}

export function useTemplatesQuery(filters: MaybeRefOrGetter<TemplateListFilters>) {
  const api = useApi()
  const query = useInfiniteQuery(computed(() => templateQueries.list(api, toValue(filters))))
  onServerPrefetch(query.suspense)
  return query
}

export function useTemplateQuery(templateId: MaybeRefOrGetter<string>) {
  const api = useApi()
  const query = useQuery(computed(() => templateQueries.detail(api, toValue(templateId))))
  onServerPrefetch(query.suspense)
  return query
}

export function useTemplateVersionsQuery(templateId: MaybeRefOrGetter<string>) {
  const api = useApi()
  const query = useQuery(computed(() => templateQueries.versions(api, toValue(templateId))))
  onServerPrefetch(query.suspense)
  return query
}

export function useTemplateVersionQuery(templateId: MaybeRefOrGetter<string>, versionId: MaybeRefOrGetter<string | null | undefined>) {
  const api = useApi()
  const query = useQuery(computed(() => templateQueries.version(api, toValue(templateId), toValue(versionId))))
  return query
}

export function useTemplateDraftQuery(templateId: MaybeRefOrGetter<string>) {
  const api = useApi()
  const query = useQuery(computed(() => templateQueries.draft(api, toValue(templateId))))
  onServerPrefetch(query.suspense)
  return query
}

export function useTemplateAccessQuery(templateId: MaybeRefOrGetter<string>) {
  const api = useApi()
  const query = useQuery(computed(() => templateQueries.access(api, toValue(templateId))))
  onServerPrefetch(query.suspense)
  return query
}

export function useCreateTemplateMutation() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateTemplateBody) => api<TemplateDto>(`/templates`, { method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templateKeys.lists() }),
  })
}

export function useUpdateTemplateMutation() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { id: string, body: UpdateTemplateBody }) => api<TemplateDto>(`/templates/${params.id}`, { method: "PATCH", body: params.body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templateKeys.lists() }),
  })
}

export function useArchiveTemplateMutation() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<TemplateDto>(`/templates/${id}/archive`, { method: "POST" }),
    onSuccess: (_template, id) => Promise.all([
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: templateKeys.detail(id) }),
    ]),
  })
}

export function useRestoreTemplateMutation() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<TemplateDto>(`/templates/${id}/restore`, { method: "POST" }),
    onSuccess: (_template, id) => Promise.all([
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: templateKeys.detail(id) }),
    ]),
  })
}
