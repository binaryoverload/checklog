import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Type tests (*.test-d.ts) are checked by tsc and reported as tests
    typecheck: {
      enabled: true,
      include: ["src/**/*.test-d.ts"],
    },
  },
})
