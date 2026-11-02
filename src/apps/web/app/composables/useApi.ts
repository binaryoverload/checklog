// Calls the Express API, for example `api<Run[]>("/runs")`. During SSR it goes straight to the API
// with the visitor's cookie; in the browser it uses the same-origin /api path. Failures throw an ApiError.
export function useApi() {
  const config = useRuntimeConfig()
  const headers = import.meta.server ? useRequestHeaders(["cookie"]) : undefined

  return $fetch.create({
    baseURL: import.meta.server ? `${config.apiInternalUrl}/api` : config.public.apiBase,
    headers,
    onResponseError({ response }) {
      throw ApiError.fromResponse(response.status, response._data)
    },
  })
}
