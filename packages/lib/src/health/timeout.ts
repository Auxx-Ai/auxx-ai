// packages/lib/src/health/timeout.ts

import { HEALTH_CHECK_TIMEOUT_MS } from './types'

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve
 * within HEALTH_CHECK_TIMEOUT_MS, it rejects with the given error message.
 */
export async function withHealthCheckTimeout<T>(
  promise: Promise<T>,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), HEALTH_CHECK_TIMEOUT_MS)
    ),
  ])
}
