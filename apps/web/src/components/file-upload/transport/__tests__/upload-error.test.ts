// apps/web/src/components/file-upload/transport/__tests__/upload-error.test.ts

import { describe, expect, it } from 'vitest'
import { parseUploadErrorResponse } from '../upload-error'

/**
 * The upload routes have always composed a real message and the browser has never
 * read one — all three call sites threw `` `… (${res.status})` `` and dropped the
 * body (PR 4c). These cases pin the two envelopes the routes actually return, both
 * read off `apps/web/src/app/api/files/upload/**` and
 * `packages/lib/src/files/upload/errors.ts` as they stand after PR 4e.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('parseUploadErrorResponse', () => {
  it('surfaces the storage-limit upgrade prompt that used to render as "Session create failed (403)"', async () => {
    // Verbatim from `api/files/upload/sessions/route.ts`'s quota gate.
    const error = await parseUploadErrorResponse(
      jsonResponse(403, {
        error: 'USAGE_LIMIT',
        message:
          'You have reached your storage limit. Usage: 4.8GB/5GB. Upgrade your plan for more storage.',
        details: { metric: 'storageGb', current: '4.8', limit: '5', upgradeRequired: 'true' },
      }),
      'Session create failed'
    )

    expect(error.message).toBe(
      'You have reached your storage limit. Usage: 4.8GB/5GB. Upgrade your plan for more storage.'
    )
    // `error` is the CODE in this envelope, not the prose.
    expect(error.code).toBe('USAGE_LIMIT')
    expect(error.status).toBe(403)
    expect(error.retryable).toBe(false)
    expect(error.details?.upgradeRequired).toBe('true')
  })

  it('reads the files.manage 403 the isAuxxError branch returns', async () => {
    const error = await parseUploadErrorResponse(
      jsonResponse(403, { error: 'FORBIDDEN', message: 'Missing permission: files.manage' }),
      'Session create failed'
    )

    expect(error.message).toBe('Missing permission: files.manage')
    expect(error.code).toBe('FORBIDDEN')
  })

  it('reads the lib envelope, where `error` is the prose and `code` is separate', async () => {
    // What `uploadErrorResponse` returns for a post-upload policy violation (422).
    const error = await parseUploadErrorResponse(
      jsonResponse(422, {
        error: 'Uploaded object is 12MB, over the 10MB limit for this entity type',
        errorType: 'validation',
        retryable: false,
        code: 'VALIDATION_ERROR',
      }),
      'Complete failed'
    )

    expect(error.message).toBe('Uploaded object is 12MB, over the 10MB limit for this entity type')
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.errorType).toBe('validation')
    expect(error.retryable).toBe(false)
  })

  it('keeps a malformed-body 400 non-retryable and distinct from a 5xx', async () => {
    const error = await parseUploadErrorResponse(
      jsonResponse(400, {
        error: 'Invalid completion request format',
        errorType: 'validation',
        retryable: false,
        code: 'VALIDATION_ERROR',
      }),
      'Complete failed'
    )

    expect(error.status).toBe(400)
    expect(error.retryable).toBe(false)
  })

  it('trusts the body over the status for retryability', async () => {
    const error = await parseUploadErrorResponse(
      jsonResponse(500, {
        error: 'An unexpected error occurred. Please try again.',
        errorType: 'unknown',
        retryable: true,
        code: 'UNKNOWN_ERROR',
      }),
      'Complete failed'
    )

    expect(error.retryable).toBe(true)
  })

  it('falls back to the old message when the body is not JSON at all', async () => {
    const error = await parseUploadErrorResponse(
      new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      'Session create failed'
    )

    // Byte-identical to what the inline fetch threw, so nothing regresses to blank.
    expect(error.message).toBe('Session create failed (502)')
    expect(error.retryable).toBe(true)
    expect(error.code).toBeUndefined()
  })

  it('falls back when the body is JSON but says nothing usable', async () => {
    const error = await parseUploadErrorResponse(jsonResponse(404, {}), 'Complete failed')

    expect(error.message).toBe('Complete failed (404)')
    expect(error.retryable).toBe(false)
  })
})
