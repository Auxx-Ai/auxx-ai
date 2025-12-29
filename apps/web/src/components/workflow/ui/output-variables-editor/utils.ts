// apps/web/src/components/workflow/ui/output-variables/utils.ts

import type { OutputVariable } from './types'

/**
 * Validates a variable name
 * @param name - The variable name to validate
 * @returns true if valid, false otherwise
 */
export function validateVariableName(name: string): boolean {
  // Must start with letter or underscore, followed by letters, numbers, or underscores
  const pattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/
  return pattern.test(name) && name.length > 0 && name.length <= 64
}

/**
 * Generates a default variable name
 * @param index - The index of the variable
 * @returns A default variable name
 */
export function generateDefaultVariableName(index: number): string {
  return `output_${index + 1}`
}

/**
 * Checks if a variable name is unique within the outputs array
 * @param name - The variable name to check
 * @param outputs - The array of output variables
 * @param currentIndex - The index of the current variable (to exclude from check)
 * @returns true if unique, false otherwise
 */
export function isVariableNameUnique(
  name: string,
  outputs: OutputVariable[],
  currentIndex: number
): boolean {
  return !outputs.some((output, index) => index !== currentIndex && output.variable === name)
}

/**
 * Sanitizes a variable name by removing invalid characters
 * @param name - The variable name to sanitize
 * @returns A sanitized variable name
 */
export function sanitizeVariableName(name: string): string {
  // Remove invalid characters and replace spaces with underscores
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[0-9]/, '_$&') // Prefix numbers at start with underscore
    .slice(0, 64) // Limit length
}

/**
 * Gets a validation error message for a variable name
 * @param name - The variable name to validate
 * @param outputs - The array of output variables
 * @param currentIndex - The index of the current variable
 * @returns Error message or null if valid
 */
export function getVariableNameError(
  name: string,
  outputs: OutputVariable[],
  currentIndex: number
): string | null {
  if (!name) {
    return 'Variable name is required'
  }

  if (!validateVariableName(name)) {
    return 'Variable name must start with a letter or underscore and contain only letters, numbers, and underscores'
  }

  if (!isVariableNameUnique(name, outputs, currentIndex)) {
    return 'Variable name must be unique'
  }

  return null
}
