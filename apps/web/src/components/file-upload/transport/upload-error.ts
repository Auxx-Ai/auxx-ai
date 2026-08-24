// apps/web/src/components/file-upload/transport/upload-error.ts

/**
 * Reading an upload route's error body.
 *
 * ## Why this file exists
 *
 * Before it, all three browser call sites did exactly this:
 *
 * ```ts
 * if (!res.ok) throw new Error(`Session create failed (${res.status})`)
 * ```
 *
 * — the body was never read. The routes have always composed a real message, and
 * none of it had ever reached a user. The most visible casualty was the storage
 * quota gate in `api/files/upload/sessions/route.ts`, which answers 403 with
 * *"You have reached your storage limit. Usage: 4.8GB/5GB. Upgrade your plan for
 * more storage."* and rendered in the uploader as **"Session create failed
 * (403)"**. Same for the post-upload policy violation PR 4e made a 422 with the
 * real reason on it.
 *
 * ## Two body shapes, not one
 *
 * The upload routes answer with two different envelopes, and both are current:
 *
 * 1. **The lib shape**, from `packages/lib/src/files/upload/errors.ts` —
 *    `{ error: <message>, errorType, retryable, code, details? }`. Used by
 *    `uploadErrorResponse`, `uploadValidationError` and `uploadUnauthorizedError`,
 *    so by every failure on `/parts` and `/complete` and most of `/sessions`.
 * 2. **The route shape** — `{ error: <CODE>, message: <message>, details? }`.
 *    Used by the `isAuxxError` branch of `/sessions` (which
 *    `session-error-mapping.test.ts` pins) and by the storage-limit 403, whose
 *    `error` is the literal string `'USAGE_LIMIT'`.
 *
 * They collide on `error`: in one it is the prose, in the other it is the code.
 * The discriminator used here is the presence of **both** `error` and `message`,
 * which only the route shape has.
 */

/** A non-2xx answer from an upload route, with the body actually read. */
export class UploadTransportError extends Error {
  /** HTTP status the route answered with. */
  readonly status: number
  /** Stable machine-readable code, when the body carried one. */
  readonly code?: string
  /** Coarse family from the lib shape (`validation`, `quota`, ...), when present. */
  readonly errorType?: string
  /** True when the same request may succeed unchanged on a retry. */
  readonly retryable: boolean
  /** Client-facing diagnostic fields the route chose to surface. */
  readonly details?: Record<string, unknown>

  constructor(
    message: string,
    init: {
      status: number
      code?: string
      errorType?: string
      retryable: boolean
      details?: Record<string, unknown>
    }
  ) {
    super(message)
    this.name = 'UploadTransportError'
    this.status = init.status
    this.code = init.code
    this.errorType = init.errorType
    this.retryable = init.retryable
    this.details = init.details
  }
}

/**
 * Narrow a caught value to an {@link UploadTransportError}.
 *
 * Checks `name` rather than `instanceof` so a value that crossed a module or
 * bundle boundary still reads as one.
 */
export function isUploadTransportError(error: unknown): error is UploadTransportError {
  return error instanceof Error && error.name === 'UploadTransportError'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Build the {@link UploadTransportError} for a failed upload-route response.
 *
 * @param response The non-2xx response. Its body is consumed.
 * @param fallback Prefix for the message when the body says nothing usable —
 *   rendered as `` `${fallback} (${status})` ``, which is byte-identical to the
 *   string the inline `fetch` sites used to throw, so nothing regresses to an
 *   empty message.
 */
export async function parseUploadErrorResponse(
  response: Response,
  fallback: string
): Promise<UploadTransportError> {
  let body: Record<string, unknown> | null = null
  try {
    body = asRecord(await response.json())
  } catch {
    body = null
  }

  const errorField = asString(body?.error)
  const messageField = asString(body?.message)

  // Only the route shape carries both, and there its `error` is the code.
  const isRouteShape = errorField !== undefined && messageField !== undefined

  const message = isRouteShape ? messageField : (errorField ?? messageField)
  const code = isRouteShape ? errorField : asString(body?.code)

  return new UploadTransportError(message ?? `${fallback} (${response.status})`, {
    status: response.status,
    code,
    errorType: asString(body?.errorType),
    retryable:
      typeof body?.retryable === 'boolean'
        ? body.retryable
        : response.status >= 500 || response.status === 429,
    details: asRecord(body?.details) ?? undefined,
  })
}
