// packages/lib/src/files/upload/__tests__/errors.test.ts

/**
 * The upload error classifier, with **zero `vi.mock` calls and zero doubles**.
 *
 * That is the point of PR 4c. The function this replaces read the *prose* of an
 * error message, so the only way to pin its behaviour was to guess the English
 * an upstream SDK would produce. What is asserted below is structure: a thrown
 * `AuxxError` subclass and the status it carries.
 *
 * The `reclassification traps` block is the regression guard — each case is a
 * message the substring ladder scored wrongly, and every one of them is now a
 * plain 500 because nothing about the message is consulted.
 */

import { describe, expect, it } from 'vitest'
import {
  AuxxError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  UnprocessableEntityError,
  UsageLimitError,
} from '../../../errors'
import {
  classifyUploadError,
  toUploadErrorResponse,
  UNEXPECTED_UPLOAD_ERROR_MESSAGE,
  uploadErrorResponse,
  uploadUnauthorizedError,
  uploadValidationError,
} from '../errors'

describe('classifyUploadError — status comes off the error, not the message', () => {
  const cases: Array<[string, AuxxError, number, string, string]> = [
    ['BadRequestError', new BadRequestError('bad body'), 400, 'validation', 'VALIDATION_ERROR'],
    [
      'UnauthorizedError',
      new UnauthorizedError('no session'),
      401,
      'authentication',
      'UNAUTHORIZED',
    ],
    ['ForbiddenError', new ForbiddenError('not yours'), 403, 'permission', 'PERMISSION_ERROR'],
    ['NotFoundError', new NotFoundError('gone'), 404, 'validation', 'NOT_FOUND'],
    ['ConflictError', new ConflictError('raced'), 409, 'validation', 'CONFLICT'],
    [
      'UnprocessableEntityError',
      new UnprocessableEntityError('too big'),
      422,
      'validation',
      'VALIDATION_ERROR',
    ],
    ['RateLimitError', new RateLimitError('slow down'), 429, 'quota', 'RATE_LIMITED'],
    ['bare AuxxError', new AuxxError('internal'), 500, 'unknown', 'UNKNOWN_ERROR'],
  ]

  for (const [name, error, status, errorType, code] of cases) {
    it(`maps ${name} to ${status}`, () => {
      const { status: got, body } = classifyUploadError(error)
      expect(got).toBe(status)
      expect(body.errorType).toBe(errorType)
      expect(body.code).toBe(code)
    })
  }

  it('maps an unexpected non-AuxxError to 500', () => {
    const { status, body } = classifyUploadError(new TypeError('cannot read x of undefined'))
    expect(status).toBe(500)
    expect(body.errorType).toBe('unknown')
    expect(body.code).toBe('UNKNOWN_ERROR')
  })

  it('maps a thrown non-Error to 500 without inspecting it', () => {
    expect(classifyUploadError('boom').status).toBe(500)
    expect(classifyUploadError(undefined).status).toBe(500)
    expect(classifyUploadError({ statusCode: 400 }).status).toBe(500)
  })

  it('inherits the right row for a subclass of a subclass', () => {
    // UsageLimitError extends AuxxError with statusCode 403; nothing had to be
    // added to the table for it, which is why the table is keyed by status.
    const { status, body } = classifyUploadError(
      new UsageLimitError({ metric: 'storageGb', current: 12, limit: 10 })
    )
    expect(status).toBe(403)
    expect(body.errorType).toBe('permission')
    expect(body.details).toMatchObject({ metric: 'storageGb', upgradeRequired: 'true' })
  })
})

describe('classifyUploadError — reclassification traps the substring ladder fell into', () => {
  // Each message below scored a WRONG status under `categorizeError`. The point
  // is not that 500 is the ideal answer for an unexpected error — it is that the
  // answer no longer depends on the words.
  const traps: Array<[string, string]> = [
    ['a rate limit, read as a storage quota -> 413 "upgrade your plan"', 'Rate limit exceeded'],
    ['a multipart token, read as an auth failure -> 401 "reconnect"', 'Malformed upload token'],
    ['an S3 key miss, read as retryable storage -> 500 before validation', 'Invalid bucket name'],
    ['an ETag mismatch, read as file corruption', 'etag header missing from response'],
    ['a part-count ceiling, read as a plan limit', 'Part number limit reached'],
    ['a socket reset, read as a network error', 'ECONNRESET while reading body'],
  ]

  for (const [why, message] of traps) {
    it(`no longer reclassifies: ${why}`, () => {
      const { status, body } = classifyUploadError(new Error(message))
      expect(status).toBe(500)
      expect(body.code).toBe('UNKNOWN_ERROR')
      expect(body.error).toBe(UNEXPECTED_UPLOAD_ERROR_MESSAGE)
    })
  }

  it('two errors sharing a phrase get different statuses when their types differ', () => {
    // Both messages contain "limit". Under the ladder both were 413.
    expect(classifyUploadError(new BadRequestError('limit must be a number')).status).toBe(400)
    expect(classifyUploadError(new RateLimitError('limit exceeded')).status).toBe(429)
  })
})

describe('classifyUploadError — what the body says', () => {
  it('surfaces a 4xx message, because we wrote it', () => {
    const { body } = classifyUploadError(
      new UnprocessableEntityError('Size mismatch: expected 100, got 200')
    )
    expect(body.error).toBe('Size mismatch: expected 100, got 200')
  })

  it('withholds every 5xx message, even from an AuxxError', () => {
    // `session.ts` throws `new AuxxError('Redis is required for upload sessions
    // but is unavailable')`. That names infrastructure and must not reach a
    // browser; the log gets it instead.
    const { body } = classifyUploadError(new AuxxError('Redis is unavailable at 10.0.0.4:6379'))
    expect(body.error).toBe(UNEXPECTED_UPLOAD_ERROR_MESSAGE)
  })

  it('marks 5xx and 429 retryable and nothing else', () => {
    expect(classifyUploadError(new Error('x')).body.retryable).toBe(true)
    expect(classifyUploadError(new RateLimitError('x')).body.retryable).toBe(true)
    expect(classifyUploadError(new BadRequestError('x')).body.retryable).toBe(false)
    expect(classifyUploadError(new ForbiddenError('x')).body.retryable).toBe(false)
    expect(classifyUploadError(new NotFoundError('x')).body.retryable).toBe(false)
  })

  it('omits `details` entirely when there are none', () => {
    expect(classifyUploadError(new BadRequestError('x')).body).not.toHaveProperty('details')
  })

  it('merges caller details over the error’s own', () => {
    const error = new BadRequestError('x', { field: 'mimeType', hint: 'from the error' })
    const { body } = classifyUploadError(error, { hint: 'from the caller', extra: 1 })
    expect(body.details).toEqual({ field: 'mimeType', hint: 'from the caller', extra: 1 })
  })

  it('drops keys whose value is undefined rather than emitting them', () => {
    const { body } = classifyUploadError(new BadRequestError('x'), { a: 1, b: undefined })
    expect(body.details).toEqual({ a: 1 })
  })
})

describe('the Response builders', () => {
  it('toUploadErrorResponse renders status, JSON content type and body', async () => {
    const res = toUploadErrorResponse(new ForbiddenError('not yours'))
    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await res.json()).toEqual({
      error: 'not yours',
      errorType: 'permission',
      retryable: false,
      code: 'PERMISSION_ERROR',
    })
  })

  it('uploadErrorResponse agrees with the classifier it logs', async () => {
    const res = uploadErrorResponse(new NotFoundError('gone'), {
      operation: 'upload-completion',
      sessionId: 'sess_1',
      context: { partNumber: 3 },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(classifyUploadError(new NotFoundError('gone')).body)
  })

  it('never leaks the log-only meta into the body', async () => {
    const res = uploadErrorResponse(new BadRequestError('nope'), {
      operation: 'part-request-processing',
      sessionId: 'sess_secret',
      context: { internalKey: 'org/private/key.png' },
    })
    const body = (await res.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'errorType', 'retryable'])
  })

  it('uploadValidationError is a 400 carrying the caller’s details', async () => {
    const res = uploadValidationError('Not a multipart upload session', {
      isMultipart: false,
      hasUploadId: false,
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Not a multipart upload session',
      errorType: 'validation',
      retryable: false,
      code: 'VALIDATION_ERROR',
      details: { isMultipart: false, hasUploadId: false },
    })
  })

  it('uploadUnauthorizedError is a 401 with a default reason', async () => {
    expect(await uploadUnauthorizedError().json()).toEqual({
      error: 'Unauthorized access',
      errorType: 'authentication',
      retryable: false,
      code: 'UNAUTHORIZED',
    })
    expect(uploadUnauthorizedError('User session required').status).toBe(401)
  })
})
