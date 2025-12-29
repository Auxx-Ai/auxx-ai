import { nodeConfig } from '@auxx/eslint-config/node'

/** @type {import("eslint").Linter.Config} */
export default [
  ...nodeConfig,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Most rules are now disabled in base config for more lenient linting
    },
  },
]
