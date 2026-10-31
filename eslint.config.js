import { defineConfig } from 'eslint/config'
import shared from './eslint.shared.js'

export default defineConfig(
  // The web app has its own config that wraps the shared one with Nuxt's rules
  { ignores: ['src/apps/web/**'] },
  shared,
)
