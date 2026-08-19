// packages/lib/src/webhooks/inbound/signed-request.ts
// Meta's `signed_request` contract — a DIFFERENT primitive from the `X-Hub-Signature-256`
// header HMAC that `metaPreset` describes.
//
// The Graph *webhook* contract (`metaPreset`) signs the raw request body and ships the digest
// in a header. The data-deletion and deauthorize callbacks ship no signature header at all:
// they POST `application/x-www-form-urlencoded` with a single `signed_request` field shaped
//
//     <base64url(signature)>.<base64url(json_payload)>
//
// and the HMAC-SHA256 covers the *base64url payload string exactly as transmitted* — not the
// decoded JSON, not the whole body. Verifying these with `metaPreset` would reject every real
// request, which is why this lives here rather than as another preset.

import { createHmac } from 'node:crypto'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError } from '../../errors'
import { timingSafeStringEqual } from './verify'

/** Meta only ever signs these callbacks with HMAC-SHA256; anything else is a downgrade attempt. */
const REQUIRED_ALGORITHM = 'HMAC-SHA256'

/** Replay window: a `signed_request` older than this is refused. */
const MAX_AGE_SECONDS = 10 * 60

/** Clock-skew tolerance for an `issued_at` in the future. Beyond it the payload is implausible. */
const MAX_FUTURE_SKEW_SECONDS = 5 * 60

/** The three fields Meta's deletion / deauthorize payloads carry. */
type SignedRequestPayload = {
  algorithm?: unknown
  issued_at?: unknown
  user_id?: unknown
}

/** The verified identity a Meta deletion / deauthorize callback carries. */
export type SignedRequest = {
  /** Meta's app-scoped id (ASID) of the person who authorized the app. Not a PSID. */
  userId: string
  /** Unix seconds at which Meta signed the request. */
  issuedAt: number
}

/** base64url alphabet, unpadded — Meta strips `=` and uses `-`/`_` for `+`/`/`. */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

function decodeBase64Url(segment: string): Buffer {
  return Buffer.from(segment, 'base64url')
}

function invalid(reason: string): Result<SignedRequest, BadRequestError> {
  return err<SignedRequest, BadRequestError>(
    new BadRequestError(`Invalid signed_request: ${reason}`)
  )
}

/**
 * Verify and decode a Meta `signed_request` (data deletion / deauthorize callbacks).
 *
 * The HMAC-SHA256 is computed with the app secret over the encoded payload segment as
 * transmitted, and compared in constant time. Rejects a malformed envelope, a non-base64url
 * segment, an `algorithm` other than `HMAC-SHA256`, a signature mismatch, a missing `user_id`,
 * and an `issued_at` outside the replay window.
 *
 * @param signedRequest The raw `signed_request` form field, `<base64url sig>.<base64url payload>`.
 * @param appSecret The Meta app secret the callback was signed with.
 * @param now Unix seconds to evaluate the replay window against. Defaults to the wall clock.
 */
export function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
  now: number = Math.floor(Date.now() / 1000)
): Result<SignedRequest, BadRequestError> {
  if (!signedRequest) return invalid('empty')
  if (!appSecret) return invalid('no app secret configured')

  const parts = signedRequest.split('.')
  if (parts.length !== 2) return invalid('expected exactly one "." separator')

  const [encodedSignature, encodedPayload] = parts as [string, string]
  if (!encodedSignature || !encodedPayload) return invalid('empty signature or payload segment')
  if (!BASE64URL_RE.test(encodedSignature) || !BASE64URL_RE.test(encodedPayload)) {
    return invalid('segments are not base64url')
  }

  let payload: SignedRequestPayload
  try {
    payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8')) as SignedRequestPayload
  } catch {
    return invalid('payload is not JSON')
  }
  if (!payload || typeof payload !== 'object') return invalid('payload is not an object')

  if (payload.algorithm !== REQUIRED_ALGORITHM) {
    return invalid(`unsupported algorithm ${String(payload.algorithm)}`)
  }

  // The HMAC covers the ENCODED payload string, not the decoded JSON.
  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest('base64url')
  if (!timingSafeStringEqual(encodedSignature, expected)) return invalid('signature mismatch')

  const userId = payload.user_id
  if (typeof userId !== 'string' || !userId) return invalid('missing user_id')

  const issuedAt = payload.issued_at
  if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt))
    return invalid('missing issued_at')
  if (issuedAt < now - MAX_AGE_SECONDS) return invalid('issued_at is too old')
  if (issuedAt > now + MAX_FUTURE_SKEW_SECONDS) return invalid('issued_at is in the future')

  return ok({ userId, issuedAt })
}
