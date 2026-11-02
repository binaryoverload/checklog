// Shared ESLint config for every package. The web app wraps it with withNuxt().
import eslintCommentPlugin from "@eslint-community/eslint-plugin-eslint-comments/configs"
import js from "@eslint/js"
import stylistic from "@stylistic/eslint-plugin"
import importPlugin from "eslint-plugin-import-x"
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
    rules: {
      // Type-only imports use `import type`, matching verbatimModuleSyntax
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "separate-type-imports" }],
      // A warning, so unfinished code still lints
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  // Every eslint-disable comment must say why, and must not be left open
  {
    name: "checklog/eslint-comments",
    extends: [eslintCommentPlugin.recommended],
    rules: {
      "@eslint-community/eslint-comments/disable-enable-pair": ["error", { allowWholeFile: true }],
      "@eslint-community/eslint-comments/require-description": "error",
    },
  },
  // Import order and style only; TypeScript already checks that imports resolve
  {
    name: "checklog/imports",
    plugins: { "import-x": importPlugin },
    rules: {
      "import-x/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "import-x/first": "error",
      "import-x/newline-after-import": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-mutable-exports": "error",
      "import-x/no-named-default": "error",
      "import-x/order": ["error", {
        "groups": ["builtin", "external", "internal", ["parent", "sibling", "index"]],
        // Workspace packages, the @ alias and Nuxt's ~ and # aliases count as internal
        "pathGroups": [
          { pattern: "@checklog/**", group: "internal" },
          { pattern: "@/**", group: "internal" },
          { pattern: "~/**", group: "internal" },
          { pattern: "#*", group: "internal" },
        ],
        "pathGroupsExcludedImportTypes": ["builtin"],
        "newlines-between": "always",
        "alphabetize": { order: "asc", caseInsensitive: true },
      }],
    },
  },
  // App source reaches other folders through an alias; config files may still import from parent folders
  {
    name: "checklog/no-parent-imports",
    files: ["src/**", "app/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["../*"], message: "Import from another folder with the @/ alias (~/ in the web app)." }] }],
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
  // Braces, brackets and their items go all on one line or one per line, never mixed
  {
    name: "checklog/stylistic-newlines",
    rules: {
      "@stylistic/object-curly-newline": ["error", { multiline: true, consistent: true }],
      "@stylistic/object-property-newline": ["error", { allowAllPropertiesOnSameLine: true }],
      "@stylistic/array-bracket-newline": ["error", "consistent"],
      "@stylistic/array-element-newline": ["error", "consistent"],
    },
  },
)
