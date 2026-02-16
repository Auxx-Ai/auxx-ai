// apps/web/src/utils/capture-error.ts
import posthog from 'posthog-js'
import { type ApiErrorType, checkCommonErrors } from '~/utils/error'

/**
 * Classifies an error using checkCommonErrors() and captures a PostHog event.
 * Returns the classified error for display in toast.
 */
export function captureClassifiedError(error: unknown, context: string): ApiErrorType | null {
  const classified = checkCommonErrors(error, context)
  if (!classified || !posthog.__loaded) return classified

  posthog.capture('integration_error', {
    context,
    error_type: classified.type,
    error_code: classified.code,
    message: classified.message,
  })

  return classified
}
