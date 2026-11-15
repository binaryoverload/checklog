import { MutationCache, QueryClient, VueQueryPlugin, dehydrate, hydrate } from "@tanstack/vue-query"
import type { DehydratedState, VueQueryPluginOptions } from "@tanstack/vue-query"

// Queries fetched during SSR are dehydrated into the payload and hydrated in the browser,
// so pages do not fetch the same data twice
export default defineNuxtPlugin((nuxt) => {
  const vueQueryState = useState<DehydratedState | null>("vue-query")

  const toast = useToast()

  const queryClient = new QueryClient({
    // Mutations that don't handle their own errors show them as a toast
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.handlesErrors) return
        toast.add({ title: error.message, color: "error", icon: "i-lucide-circle-alert" })
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 5000,
        networkMode: "always", // Don't pause queries when offline
        // Only network failures and server errors are worth retrying; a 4xx gives the same answer again
        retry: (failureCount, error) => failureCount < 2 && !(error instanceof ApiError && error.status < 500),
      },
      mutations: {
        networkMode: "always", // Don't pause queries when offline
      },
    },
  })
  const options: VueQueryPluginOptions = { queryClient }

  nuxt.vueApp.use(VueQueryPlugin, options)

  if (import.meta.server) {
    nuxt.hooks.hook("app:rendered", () => {
      vueQueryState.value = dehydrate(queryClient)
    })
  }

  if (import.meta.client) {
    nuxt.hooks.hook("app:created", () => {
      if (vueQueryState.value) {
        hydrate(queryClient, vueQueryState.value)
      }
    })
  }

  // Route middleware runs outside components, where useQueryClient() isn't available
  return { provide: { queryClient } }
})
