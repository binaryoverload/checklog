// Shared ESLint config for every package. The web app wraps it with withNuxt().
import js from "@eslint/js"
import stylistic from "@stylistic/eslint-plugin"
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"
import tseslint from "typescript-eslint"

const tsFiles = ["**/*.ts", "**/*.mts", "**/*.cts"]

export default defineConfig(
  // Build output, caches and generated files. Directory patterns (trailing /) stop ESLint descending into them at all
  globalIgnores([
    "**/dist/",
    "**/.output/",
    "**/.nuxt/",
    "**/.nitro/",
    "**/.cache/",
    "**/.data/",
    "**/coverage/",
    "**/drizzle/",
  ], "checklog/build-output"),
  js.configs.recommended,
  {
    files: tsFiles,
    extends: [tseslint.configs.recommended],
  },
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  stylistic.configs.customize({
    indent: 2,
    quotes: "double",
    semi: false,
    commaDangle: "always-multiline",
    braceStyle: "1tbs",
    quoteProps: "consistent-as-needed",
  }),
)
