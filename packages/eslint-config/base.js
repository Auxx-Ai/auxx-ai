import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import turboPlugin from 'eslint-plugin-turbo'
import tseslint from 'typescript-eslint'
import onlyWarn from 'eslint-plugin-only-warn'

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  { plugins: { turbo: turboPlugin }, rules: { 'turbo/no-undeclared-env-vars': 'warn' } },
  { plugins: { onlyWarn } },
  { ignores: ['dist/**'] },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-case-declarations': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-useless-escape': 'off',
      'no-prototype-builtins': 'off',
      'no-control-regex': 'off',
      'no-useless-catch': 'off',
      'no-constant-condition': 'off',
      'no-fallthrough': 'off',
      'no-constant-binary-expression': 'off',
      'no-extra-boolean-cast': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
]
