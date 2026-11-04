import path from "node:path"

import { defineConfig } from "eslint/config"
import { createNodeResolver } from "eslint-plugin-import-x"

import shared from "./eslint.shared.js"

export default defineConfig(
  // The web app has its own config that wraps the shared one with Nuxt's rules
  { ignores: ["src/apps/web/**"] },
  shared,
  // API imports of its own files name the .ts file. The resolver reads tsconfig paths, so @/ imports are checked too.
  // No autofix: it would turn a folder import like @/db into @/db.ts rather than @/db/index.ts.
  {
    name: "checklog/api-import-extensions",
    files: ["src/apps/api/**/*.ts"],
    settings: {
      "import-x/resolver-next": [createNodeResolver({ extensions: [".ts", ".js", ".json"], tsconfig: { configFile: path.join(import.meta.dirname, "src/apps/api/tsconfig.json") } })],
    },
    rules: {
      "import-x/extensions": ["error", "always", {
        ignorePackages: true,
        checkTypeImports: true,
        pathGroupOverrides: [{ pattern: "@/**", action: "enforce" }],
      }],
    },
  },
)
