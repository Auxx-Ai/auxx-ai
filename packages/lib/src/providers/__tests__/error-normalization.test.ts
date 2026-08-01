// packages/lib/src/providers/__tests__/error-normalization.test.ts

import { describe, expect, it } from 'vitest'
import { EmailErrorCode, ErrorNormalizer, extractProviderErrorText } from '../error-normalization'

/** The exact shape `outlook-provider.ts` throws for a Graph 400. */
const graphHeaderRejection = () => ({
  statusCode: 400,
  code: 'InvalidInternetMessageHeader',
  message: "The internet message header name 'In-Reply-To' should start with 'x-' or 'X-'.",
  body: JSON.stringify({
    code: 'InvalidInternetMessageHeader',
    message: "The internet message header name 'In-Reply-To' should start with 'x-' or 'X-'.",
  }),
})

describe('ErrorNormalizer.normalizeOutlookError', () => {
  it('maps a Graph InvalidInternetMessageHeader failure to INVALID_MESSAGE_HEADER, not UNKNOWN', () => {
    const normalized = ErrorNormalizer.normalizeOutlookError(graphHeaderRejection())

    expect(normalized.code).toBe(EmailErrorCode.INVALID_MESSAGE_HEADER)
    expect(normalized.code).not.toBe(EmailErrorCode.UNKNOWN)
    expect(normalized.details).toMatchObject({ provider: 'outlook', retryable: false })
  })

  it('keeps the raw Graph message in the normalized error', () => {
    const normalized = ErrorNormalizer.normalizeOutlookError(graphHeaderRejection())

    expect(normalized.message).toContain(
      "The internet message header name 'In-Reply-To' should start with 'x-' or 'X-'."
    )
  })

  it('detects the rejection from the response body alone', () => {
    // Graph clients that surface only the body string still have to normalize.
    const normalized = ErrorNormalizer.normalizeOutlookError({
      statusCode: 400,
      message: 'Request failed with status code 400',
      body: '{"code":"InvalidInternetMessageHeader","message":"…should start with \'x-\'"}',
    })

    expect(normalized.code).toBe(EmailErrorCode.INVALID_MESSAGE_HEADER)
  })

  it('gives a specific user message instead of the generic fallback', () => {
    const normalized = ErrorNormalizer.normalizeOutlookError(graphHeaderRejection())
    const userMessage = ErrorNormalizer.getUserMessage(normalized)

    expect(userMessage).not.toBe('Failed to send message. Please try again.')
    expect(userMessage.toLowerCase()).toContain('header')
  })

  // Regression guards: the new branch sits after every existing one.
  it('still maps 429 to RATE_LIMIT', () => {
    const normalized = ErrorNormalizer.normalizeOutlookError({
      statusCode: 429,
      message: 'Too many requests',
    })

    expect(normalized.code).toBe(EmailErrorCode.RATE_LIMIT)
    expect(normalized.details?.retryable).toBe(true)
    expect(ErrorNormalizer.getUserMessage(normalized)).toBe(
      'Sending limit reached. Please wait a moment and try again.'
    )
  })

  it('still maps 5xx to SERVICE_UNAVAILABLE', () => {
    expect(ErrorNormalizer.normalizeOutlookError({ statusCode: 500, message: 'boom' }).code).toBe(
      EmailErrorCode.SERVICE_UNAVAILABLE
    )
    expect(ErrorNormalizer.normalizeOutlookError({ statusCode: 503, message: 'boom' }).code).toBe(
      EmailErrorCode.SERVICE_UNAVAILABLE
    )
  })

  it('still maps 401 to AUTH_FAILED and 413 to SIZE_LIMIT_EXCEEDED', () => {
    expect(ErrorNormalizer.normalizeOutlookError({ statusCode: 401 }).code).toBe(
      EmailErrorCode.AUTH_FAILED
    )
    expect(ErrorNormalizer.normalizeOutlookError({ statusCode: 413 }).code).toBe(
      EmailErrorCode.SIZE_LIMIT_EXCEEDED
    )
  })

  it('still falls through to UNKNOWN for unrecognised failures', () => {
    const normalized = ErrorNormalizer.normalizeOutlookError({
      statusCode: 400,
      message: 'Something else entirely',
    })

    expect(normalized.code).toBe(EmailErrorCode.UNKNOWN)
    expect(ErrorNormalizer.getUserMessage(normalized)).toBe(
      'Failed to send message. Please try again.'
    )
  })
})

describe('extractProviderErrorText', () => {
  it('combines the provider message and response body', () => {
    const raw = extractProviderErrorText(graphHeaderRejection())

    expect(raw).toContain("should start with 'x-'")
    expect(raw).toContain('InvalidInternetMessageHeader')
  })

  it('unwraps a NormalizedEmailError back to the provider error', () => {
    const normalized = ErrorNormalizer.normalizeOutlookError(graphHeaderRejection())
    const raw = extractProviderErrorText(normalized)

    expect(raw).toContain("The internet message header name 'In-Reply-To'")
  })

  it('returns undefined when there is nothing to record', () => {
    expect(extractProviderErrorText(undefined)).toBeUndefined()
    expect(extractProviderErrorText(null)).toBeUndefined()
    expect(extractProviderErrorText({})).toBeUndefined()
  })
})
