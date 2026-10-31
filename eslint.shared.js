// Shared ESLint config for every package. The web app wraps it with withNuxt().
import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const tsFiles = ['**/*.ts', '**/*.mts', '**/*.cts']

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/.output/**', '**/.nuxt/**', '**/drizzle/**'],
  },
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
    quotes: 'double',
    semi: false,
    commaDangle: 'always-multiline',
    braceStyle: '1tbs',
    quoteProps: 'consistent-as-needed',
  }),
)
