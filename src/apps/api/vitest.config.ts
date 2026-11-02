import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Placeholder values so core/config.ts parses; these tests don't connect to anything
    env: {
      PUBLIC_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      BETTER_AUTH_SECRET: "test-secret-at-least-thirty-two-characters",
      EMAIL_SMTP_HOST: "localhost",
      EMAIL_FROM: "test@example.com",
      LOG_LEVEL: "error",
    },
    // Type tests (*.test-d.ts) are checked by tsc and reported as tests
    typecheck: {
      enabled: true,
      include: ["src/**/*.test-d.ts"],
    },
  },
})
