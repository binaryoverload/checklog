import type { ApiError } from "~/utils/api-error"

declare module "@tanstack/vue-query" {
  interface Register {
    // Every API call throws an ApiError, so query and mutation errors are typed as one
    defaultError: ApiError
    mutationMeta: {
      // The mutation shows its own errors, such as against form fields, so the global toast is skipped
      handlesErrors?: boolean
    }
  }
}

export {}
