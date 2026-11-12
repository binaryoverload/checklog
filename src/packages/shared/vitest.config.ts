import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // In GitHub Actions, failures are also annotated on the pull request and the results go in the job summary
    reporters: process.env.GITHUB_ACTIONS === "true"
      ? ["default", ["github-actions", { jobSummary: { title: "Shared package tests" } }]]
      : undefined,
    // Type tests (*.test-d.ts) are checked by tsc and reported as tests
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
    },
  },
})
