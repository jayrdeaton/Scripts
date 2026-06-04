const { defineConfig } = require('eslint/config')
const prettierRecommended = require('eslint-plugin-prettier/recommended')
const simpleImportSort = require('eslint-plugin-simple-import-sort')
const packageJson = require('eslint-plugin-package-json')

module.exports = defineConfig([
  {
    ignores: ['node_modules/**']
  },
  prettierRecommended,
  packageJson.configs.recommended,
  {
    extends: [packageJson.configs.recommended],
    files: ['package.json'],
    rules: {
      'package-json/order-properties': 'warn',
      'package-json/sort-collections': 'warn',
      'package-json/require-exports': 'off',
      'package-json/require-repository': 'off',
      'package-json/require-sideEffects': 'off',
      'package-json/require-attribution': 'off'
    }
  },
  {
    plugins: {
      'simple-import-sort': simpleImportSort
    },
    rules: {
      'prettier/prettier': 'warn',
      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',
      'no-console': 'off'
    }
  }
])
