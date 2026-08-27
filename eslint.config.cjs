const { defineConfig } = require('eslint/config')
const base = require('@infinitetoken/eslint-config/npm-package')

module.exports = defineConfig([
  ...base,
  {
    // this repo's source is plain .js/.mjs (no TypeScript), so re-include the
    // file types the shared preset ignores by default (it assumes .js/.mjs are build output)
    ignores: ['!**/*.js', '!**/*.mjs']
  },
  {
    rules: {
      'no-console': 'off',
      'package-json/require-exports': 'off',
      'package-json/require-repository': 'off',
      'package-json/require-sideEffects': 'off',
      'package-json/require-attribution': 'off'
    }
  }
])
