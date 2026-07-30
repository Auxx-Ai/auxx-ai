// apps/web/src/trpc/query-client.test.ts
//
// The retry predicate used to exempt 401/403 only, so every other refusal cost
// four round trips per trigger. Mail answers a lens denial with NOT_FOUND (it
// hides existence rather than admitting a thread it won't show), so a revoked
// thread left open re-asked `message.listByThread` four times on every window
// focus, remount and realtime reconnect — and got the same 404 each time.

import { describe, expect, it } from 'vitest'
import { createQueryClient, errorStatus } from './query-client'

/** The shape a tRPC HTTP link puts on a client error. */
const trpcError = (httpStatus: number, code?: string) => ({ data: { httpStatus, code } })

const retry = () => {
  const fn = createQueryClient().getDefaultOptions().queries?.retry
  if (typeof fn !== 'function') throw new Error('retry predicate is not a function')
  return fn as (failureCount: number, error: unknown) => boolean
}

describe('retry predicate', () => {
  it('does not retry a 404 — the bug this exists for', () => {
    expect(retry()(0, trpcError(404, 'NOT_FOUND'))).toBe(false)
  })

  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [422, 'UNPROCESSABLE_CONTENT'],
  ])('does not retry %i — the server already considered it', (status, code) => {
    expect(retry()(0, trpcError(status, code))).toBe(false)
  })

  it.each([
    [408, 'TIMEOUT'],
    [429, 'TOO_MANY_REQUESTS'],
  ])('DOES retry %i — the two 4xx that mean "try again"', (status, code) => {
    expect(retry()(0, trpcError(status, code))).toBe(true)
  })

  it('retries a 500 up to three times', () => {
    const fn = retry()
    expect(fn(0, trpcError(500, 'INTERNAL_SERVER_ERROR'))).toBe(true)
    expect(fn(2, trpcError(500, 'INTERNAL_SERVER_ERROR'))).toBe(true)
    expect(fn(3, trpcError(500, 'INTERNAL_SERVER_ERROR'))).toBe(false)
  })

  it('retries an error with no status at all — a network failure IS transient', () => {
    expect(retry()(0, new Error('Failed to fetch'))).toBe(true)
    expect(retry()(3, new Error('Failed to fetch'))).toBe(false)
  })
})

describe('errorStatus', () => {
  it('prefers httpStatus', () => {
    expect(errorStatus({ data: { httpStatus: 404, code: 'NOT_FOUND' } })).toBe(404)
  })

  it('falls back to the code when httpStatus is absent (a server-side caller)', () => {
    expect(errorStatus({ data: { code: 'NOT_FOUND' } })).toBe(404)
    expect(errorStatus({ data: { code: 'FORBIDDEN' } })).toBe(403)
  })

  it('is undefined for a non-tRPC error, so those keep retrying', () => {
    expect(errorStatus(new Error('boom'))).toBeUndefined()
    expect(errorStatus(undefined)).toBeUndefined()
    expect(errorStatus({ data: { code: 'NOT_A_REAL_CODE' } })).toBeUndefined()
  })
})
