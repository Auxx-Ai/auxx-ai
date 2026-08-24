// packages/lib/src/files/upload/errors.ts

/**
 * Turning an upload failure into an HTTP response — from the error's
 * **structure**, never from its prose.
 *
 * ## What this replaces
 *
 * `UploadErrorHandler.categorizeError` lower-cased the message and ran it
 * through seven `includes(...)` ladders to pick a category, and the category
 * picked the status:
 *
 * ```ts
 * if (lowerMessage.includes('storage') || lowerMessage.includes('s3') ||
 *     lowerMessage.includes('bucket') || lowerMessage.includes('key not found')) …
 * ```
 *
 * Three things are wrong with that, and all three are live:
 *
 * 1. **It reclassifies when an upstream library rewords a message.** The status
 *    an S3 SDK failure produced was a property of the AWS SDK's English, not of
 *    anything this repo controls.
 * 2. **It cannot separate two errors that share a phrase.** `limit` matched the
 *    quota ladder, so *any* message containing the word — "rate limit",
 *    "part number limit", "limit exceeded" — became a 413 telling the user to
 *    upgrade their plan. `token` matched the auth ladder, so a malformed
 *    multipart *token* became a 401 telling the user to reconnect their storage
 *    account.
 * 3. **Ladder order decided ties silently.** "Invalid bucket" hit `storage`
 *    (500, retryable) before `validation` (400) purely because the storage
 *    ladder is written first.
 *
 * ## What replaces it
 *
 * `AuxxError.statusCode`. Phase 2 made every `files/` failure an `AuxxError`
 * subclass, and a subclass carries its status as a field — so the classification
 * is a property of the thrown value, decided at the `throw`, by the code that
 * knows what went wrong. {@link SHAPE_BY_STATUS} then maps that status to the
 * response's supporting fields. Anything that is *not* an `AuxxError` is, by
 * definition, unexpected: it is a 500 with a generic message and the real detail
 * in the log. There is no third case and no guessing.
 *
 * ## The body shape is a client contract
 *
 * `{ error, errorType, retryable, code, details? }` is what the browser uploader
 * already receives, and `apps/web/.../authorize-upload-session.ts` hand-rolls the
 * same shape so every failure on the surface looks alike. It is preserved
 * field-for-field; only the *derivation* changed.
 *
 * ## Pure, and testable with nothing
 *
 * {@link classifyUploadError} and {@link toUploadErrorResponse} take no `ctx`, no
 * `db`, no `deps` and no clock. {@link uploadErrorResponse} adds exactly one
 * side effect — the log line — and nothing else. Marking the Redis session
 * `failed` is deliberately *not* here: it is a session write, it lives in
 * `upload/session.ts` as `failUploadSession`, and mixing it in is what made the
 * old handler impossible to test without a Redis double.
 */

import { createScopedLogger } from '@auxx/logger'
import { AuxxError, BadRequestError, UnauthorizedError } from '../../errors'

const logger = createScopedLogger('upload-errors')

/**
 * Coarse family the browser uploader switches on.
 *
 * Deliberately smaller than the ten-member enum it replaces. Six of those ten
 * (`storage`, `processing`, `network`, `timeout`, `corruption`, `unknown`) all
 * mapped to 500 and were only ever distinguished by the substring ladder, so
 * they conveyed the classifier's guess rather than a fact. They collapse into
 * `unknown`.
 */
export type UploadErrorType = 'validation' | 'authentication' | 'permission' | 'quota' | 'unknown'

/** The JSON body every upload-route failure returns. */
export interface UploadErrorBody {
  /** Human-readable. Generic for anything 5xx — see {@link UNEXPECTED_UPLOAD_ERROR_MESSAGE}. */
  error: string
  errorType: UploadErrorType
  /** True only for 5xx and 429: the request may succeed unchanged on a retry. */
  retryable: boolean
  /** Stable machine-readable code, derived from the status. */
  code: string
  details?: Record<string, unknown>
}

/** An error resolved to the status and body an upload route should answer with. */
export interface ClassifiedUploadError {
  status: number
  body: UploadErrorBody
}

/**
 * What a status implies about the failure, for the fields the body carries
 * alongside it.
 *
 * Keyed by status rather than by error class on purpose: `AuxxError` subclasses
 * are already a table from class to status, and a second table from class to
 * category would drift from the first. Any subclass added later inherits the
 * right row automatically.
 */
const SHAPE_BY_STATUS: Readonly<Record<number, { errorType: UploadErrorType; code: string }>> =
  Object.freeze({
    400: { errorType: 'validation', code: 'VALIDATION_ERROR' },
    401: { errorType: 'authentication', code: 'UNAUTHORIZED' },
    403: { errorType: 'permission', code: 'PERMISSION_ERROR' },
    404: { errorType: 'validation', code: 'NOT_FOUND' },
    409: { errorType: 'validation', code: 'CONFLICT' },
    413: { errorType: 'quota', code: 'QUOTA_ERROR' },
    422: { errorType: 'validation', code: 'VALIDATION_ERROR' },
    429: { errorType: 'quota', code: 'RATE_LIMITED' },
  })

/** Row used for any status the table does not name — every 5xx included. */
const UNKNOWN_SHAPE = Object.freeze({ errorType: 'unknown' as const, code: 'UNKNOWN_ERROR' })

/**
 * What a 5xx tells the client.
 *
 * A server-side failure's message is written for an operator, not a user, and
 * may name a bucket, a Redis key or an SDK internal. The real message always
 * reaches the log; only this reaches the browser. Carried over verbatim from
 * `categorizeError`'s `UNKNOWN` branch so the string the UI may already be
 * matching on does not move.
 */
export const UNEXPECTED_UPLOAD_ERROR_MESSAGE = 'An unexpected error occurred. Please try again.'

/**
 * Resolve any thrown value to the status and body an upload route answers with.
 *
 * Pure. The only question asked of the error is `instanceof AuxxError`, and the
 * only field read off it is `statusCode` (plus `details`, when it carries any).
 *
 * @param error The thrown value, of any shape.
 * @param details Extra fields to surface to the client, merged over the error's
 *   own `details`. Route-supplied context that is *not* for the client belongs in
 *   {@link uploadErrorResponse}'s `context` instead, which is logged only.
 */
export function classifyUploadError(
  error: unknown,
  details?: Record<string, unknown>
): ClassifiedUploadError {
  const auxx = error instanceof AuxxError ? error : null
  const status = auxx?.statusCode ?? 500
  const shape = SHAPE_BY_STATUS[status] ?? UNKNOWN_SHAPE

  const merged: Record<string, unknown> = { ...auxx?.details, ...details }
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key]
  }

  return {
    status,
    body: {
      error: status >= 500 || !auxx ? UNEXPECTED_UPLOAD_ERROR_MESSAGE : auxx.message,
      errorType: shape.errorType,
      // 429 is the one 4xx worth retrying unchanged; every other 4xx needs the
      // caller to send something different.
      retryable: status >= 500 || status === 429,
      code: shape.code,
      ...(Object.keys(merged).length > 0 ? { details: merged } : {}),
    },
  }
}

/**
 * {@link classifyUploadError} rendered as a `Response`. Pure — no logging.
 *
 * Use this for a failure the route already understands and has decided about
 * (a rejected request body, a session in the wrong state). Use
 * {@link uploadErrorResponse} for one that arrived in a `catch`.
 */
export function toUploadErrorResponse(error: unknown, details?: Record<string, unknown>): Response {
  const { status, body } = classifyUploadError(error, details)
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Everything an upload route knows about a failure that is not the error itself. */
export interface UploadErrorMeta {
  /** Which step failed, e.g. `'session-creation'`. Logged, never returned. */
  operation: string
  /** The session the failure belongs to, when there is one. Logged, never returned. */
  sessionId?: string
  /** Additional diagnostic fields. Logged, never returned. */
  context?: Record<string, unknown>
  /** Fields to surface to the client, merged over the error's own `details`. */
  details?: Record<string, unknown>
}

/**
 * Log an upload failure and answer the client.
 *
 * The log line is where the *real* message goes, which is the half the old
 * handler got right and this keeps: a 5xx body says nothing useful on purpose,
 * so the log has to say everything.
 *
 * This does **not** mark the session failed. Call `failUploadSession` for that,
 * from the route, where it is visible.
 */
export function uploadErrorResponse(error: unknown, meta: UploadErrorMeta): Response {
  const { status, body } = classifyUploadError(error, meta.details)

  logger.error(`Upload ${meta.operation} failed`, {
    sessionId: meta.sessionId,
    operation: meta.operation,
    status,
    code: body.code,
    errorType: body.errorType,
    retryable: body.retryable,
    // The unabridged message, which the body withholds for a 5xx.
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...meta.context,
  })

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * A 400 for a request an upload route rejected before doing any work.
 *
 * Kept as its own function rather than folded into a `throw` because these are
 * early returns from *inside* the route's `try`: throwing would route them
 * through the catch, which also marks the session failed. A malformed part
 * request must not kill a multipart upload that is otherwise fine.
 */
export function uploadValidationError(
  message: string,
  details?: Record<string, unknown>
): Response {
  return toUploadErrorResponse(new BadRequestError(message), details)
}

/** A 401 for a caller with no usable auth session. */
export function uploadUnauthorizedError(reason?: string): Response {
  return toUploadErrorResponse(new UnauthorizedError(reason || 'Unauthorized access'))
}
