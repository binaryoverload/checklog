import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // In GitHub Actions, failures are also annotated on the pull request and the results go in the job summary
    reporters: process.env.GITHUB_ACTIONS === "true"
      ? ["default", ["github-actions", { jobSummary: { title: "API tests" } }]]
      : undefined,
    // Placeholder values so core/config.ts parses. Database tests replace DATABASE_URL with their container's.
    env: {
      PUBLIC_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      BETTER_AUTH_SECRET: "test-secret-at-least-thirty-two-characters",
      EMAIL_SMTP_HOST: "localhost",
      EMAIL_FROM: "test@example.com",
      LOG_LEVEL: "error",
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.db.test.ts"],
          // Type tests (*.test-d.ts) are checked by tsc and reported as tests
          typecheck: {
            enabled: true,
            include: ["test/**/*.test-d.ts"],
          },
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["test/**/*.db.test.ts"],
          // Starts a migrated Postgres in Docker once per run
          globalSetup: ["test/support/database-global-setup.ts"],
          setupFiles: ["test/support/database-setup.ts"],
          // Pulling the image and migrating can take a while on a cold run
          hookTimeout: 120_000,
        },
      },
    ],
  },
})
