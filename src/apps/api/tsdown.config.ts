import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/worker.ts", "src/migrate.ts"],
  format: "esm",
  platform: "node",
  // The shared package is TypeScript source with no build step, so bundle it in
  deps: { alwaysBundle: ["@checklog/shared"] },
})
