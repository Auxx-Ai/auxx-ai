// apps/web/src/lib/extensions/forms/error-handler.ts

import { toastError } from '@auxx/ui/components/toast'

/**
 * Handle form submission errors.
 * Shows toast notification and logs error.
 */
export function handleFormError(error: Error, context: string): void {
  console.error(`[FormReconstructor] ${context}:`, error)

  toastError({
    title: 'Form submission failed',
    description: error.message || 'An unexpected error occurred',
  })
}

/**
 * Handle deserialization errors.
 */
export function handleDeserializationError(error: Error, fieldName?: string): never {
  const message = fieldName
    ? `Failed to deserialize field "${fieldName}": ${error.message}`
    : `Failed to deserialize form schema: ${error.message}`

  console.error('[FormReconstructor]', message, error)
  throw new Error(message)
}

/**
 * Handle unknown field types.
 */
export function handleUnknownFieldType(type: string, fieldName: string): never {
  const message = `Unknown field type "${type}" for field "${fieldName}"`
  console.error('[FormReconstructor]', message)
  throw new Error(message)
}
