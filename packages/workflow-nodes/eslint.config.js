import { nodeConfig } from '@auxx/eslint-config/node'

/** @type {import("eslint").Linter.Config} */
export default [
  ...nodeConfig,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-case-declarations': 'warn',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
    },
  },
]
