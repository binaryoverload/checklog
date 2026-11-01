import withNuxt from "./.nuxt/eslint.config.mjs"
import shared from "../../../eslint.shared.js"

export default withNuxt(
  shared,
  {
    // Stylistic does not format <template> blocks, so Vue layout rules live here
    files: ["**/*.vue"],
    rules: {
      "vue/html-indent": ["error", 2],
      "vue/html-quotes": ["error", "double"],
      "vue/max-attributes-per-line": ["error", { singleline: 3, multiline: 1 }],
      "vue/html-closing-bracket-newline": "error",
      "vue/html-self-closing": "error",
      "vue/multiline-html-element-content-newline": "error",
    },
  },
)
