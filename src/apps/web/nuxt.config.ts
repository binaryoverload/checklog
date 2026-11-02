export default defineNuxtConfig({
  modules: ["@nuxt/eslint", "@nuxt/ui"],

  devtools: { enabled: true },

  css: ["~/assets/css/main.css"],

  runtimeConfig: {
    // Server-side base URL for SSR calls to the API (NUXT_API_INTERNAL_URL)
    apiInternalUrl: "http://localhost:3001",
    public: {
      // Browser calls stay on the same domain; a reverse proxy sends /api to Express
      apiBase: "/api",
    },
  },

  // Nuxt Icon's endpoint defaults to /api/_nuxt_icon, but /api belongs to the Express API
  icon: {
    localApiEndpoint: "/_nuxt_icon",
  },

  compatibilityDate: "2026-10-01",

  // Nuxt renders the UI only; in dev, forward /api to the Express API like the production proxy does
  nitro: {
    devProxy: {
      "/api": { target: "http://localhost:3001/api", changeOrigin: true },
    },
  },

  eslint: {
    config: {
      // Formatting and import rules come from the shared config; Nuxt supplies the Vue and Nuxt rules
      stylistic: false,
      import: false,
    },
  },
})
