// packages/lib/src/utils/rate-limiter/__tests__/paced-fetch.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// No Redis in this file — `pacedFetch` is exercised over the in-process fallback, which
// is the same cursor arithmetic and keeps the test about the fetch loop.
vi.mock('@auxx/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/redis')>()),
  getRedisClient: async () => null,
}))

import { pacedFetch, parseRetryAfterMs } from '../paced-fetch'
import { resetPacerState } from '../pacer'
import { connectionQuota } from '../quota'

const fetchMock = vi.fn()

function reply(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : '{}', { status, headers })
}

beforeEach(() => {
  resetPacerState()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseRetryAfterMs', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2_000)
  })

  it('reads an HTTP-date', () => {
    const when = new Date(Date.now() + 5_000).toUTCString()
    const ms = parseRetryAfterMs(when)!
    expect(ms).toBeGreaterThan(3_000)
    expect(ms).toBeLessThanOrEqual(5_000)
  })

  it('returns undefined for absent or junk values', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined()
    expect(parseRetryAfterMs('soon')).toBeUndefined()
  })
})

describe('pacedFetch', () => {
  it('returns a non-throttled response on the first attempt', async () => {
    fetchMock.mockResolvedValue(reply(200))

    const { response, attempts } = await pacedFetch(
      connectionQuota('ok', { rps: 1000 }),
      'https://example.test/x'
    )

    expect(response.status).toBe(200)
    expect(attempts).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 429 and absorbs the Retry-After through the shared cursor', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(429, { 'retry-after': '0.05' }))
      .mockResolvedValueOnce(reply(200))

    const started = Date.now()
    const { response, attempts, waitedMs } = await pacedFetch(
      connectionQuota('throttled', { rps: 1000 }),
      'https://example.test/x'
    )

    expect(response.status).toBe(200)
    expect(attempts).toBe(2)
    // The wait came from the reservation, not a local sleep — so it is REPORTED
    // (waitedMs) rather than silently spent, and it actually elapsed.
    expect(waitedMs).toBeGreaterThan(30)
    expect(Date.now() - started).toBeGreaterThan(30)
  })

  it('hands back the final throttled response once retries are exhausted', async () => {
    fetchMock.mockResolvedValue(reply(429, { 'retry-after': '0.01' }))

    const { response, attempts } = await pacedFetch(
      connectionQuota('exhausted', { rps: 1000 }),
      'https://example.test/x',
      {},
      { maxRetries: 2 }
    )

    expect(response.status).toBe(429)
    expect(attempts).toBe(3) // first + 2 retries
  })

  it('fires onThrottle once per throttled attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(429, { 'retry-after': '0.01' }))
      .mockResolvedValueOnce(reply(200))
    const onThrottle = vi.fn()

    await pacedFetch(
      connectionQuota('observed', { rps: 1000 }),
      'https://example.test/x',
      {},
      { onThrottle }
    )

    expect(onThrottle).toHaveBeenCalledTimes(1)
    expect(onThrottle).toHaveBeenCalledWith({ attempt: 0, status: 429, retryAfterMs: 10 })
  })

  it('does not retry a plain error status', async () => {
    fetchMock.mockResolvedValue(reply(500))

    const { response, attempts } = await pacedFetch(
      connectionQuota('five-hundred', { rps: 1000 }),
      'https://example.test/x'
    )

    expect(response.status).toBe(500)
    expect(attempts).toBe(1)
  })
})
