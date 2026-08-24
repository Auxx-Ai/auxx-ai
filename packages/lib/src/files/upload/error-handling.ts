// packages/lib/src/files/upload/error-handling.ts

/**
 * @deprecated Adapter kept only so `files/server.ts` and `files/index.ts` keep
 * compiling while their `UploadErrorHandler` line is swapped for the
 * `./upload/errors` exports. Delete this file together with those two lines.
 *
 * Everything that made a decision here now lives in `upload/errors.ts` and is
 * pure. What is left is the one side effect the old class hid inside its error
 * path — marking the Redis session `failed` — which PR 4e moves into the routes
 * so it is visible at the call site rather than smuggled in by a logger.
 */

import { createScopedLogger } from '@auxx/logger'
import { uploadErrorResponse, uploadUnauthorizedError, uploadValidationError } from './errors'
import { failUploadSession, uploadSessionRedis } from './session'

const logger = createScopedLogger('upload-error-handler')

/**
 * Best-effort `status: 'failed'` on the session behind a failed request, so a
 * retry of `complete` is refused by the status gate rather than half-running.
 *
 * `failUploadSession` already swallows a patch that had nothing to land on; this
 * catch covers the other failure — Redis itself being unreachable, which is what
 * {@link uploadSessionRedis} throws for.
 */
async function markSessionFailed(sessionId: string): Promise<void> {
  try {
    await failUploadSession(await uploadSessionRedis(), sessionId, () => new Date())
  } catch (error) {
    logger.warn('Could not reach Redis to mark the upload session failed', { sessionId, error })
  }
}

/** @deprecated Import `uploadErrorResponse` / `uploadValidationError` from `./errors`. */
export const UploadErrorHandler = {
  /**
   * @deprecated Replaced by `uploadErrorResponse` plus an explicit
   * `failUploadSession` call in the route.
   *
   * `sessionId` is optional because the session-create route has no session yet.
   * It used to invent `temp-${Date.now()}` purely to satisfy this parameter, and
   * this function then string-matched that prefix to decide whether to skip the
   * Redis write.
   */
  async handleUploadError(
    error: unknown,
    sessionId: string | undefined,
    operation: string,
    context?: Record<string, unknown>
  ): Promise<Response> {
    const response = uploadErrorResponse(error, { operation, sessionId, context })
    if (sessionId) await markSessionFailed(sessionId)
    return response
  },

  /** @deprecated Import `uploadValidationError` from `./errors`. */
  validationError(message: string, details?: Record<string, unknown>): Response {
    return uploadValidationError(message, details)
  },

  /** @deprecated Import `uploadUnauthorizedError` from `./errors`. */
  unauthorized(reason?: string): Response {
    return uploadUnauthorizedError(reason)
  },
} as const
