// packages/lib/src/accounting/mirror/__tests__/provider-sync-guard.test.ts
//
// A refused sync used to leave no trace at all: the `AuxxError` path returned
// `err` without logging, so the one string saying what to do existed only in
// the browser (brief 55 §2.3.1).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    error: h.error,
    warn: h.warn,
    info: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { AuxxError, UnprocessableEntityError } from '../../../errors'
import { guard } from '../guard'

const meta = { organizationId: 'org_1', from: '2026-01-01', to: '2026-09-16' }

describe('provider-sync guard', () => {
  beforeEach(() => {
    h.warn.mockClear()
    h.error.mockClear()
  })

  it('warns and returns the refusal when the body throws an AuxxError', async () => {
    const refusal = new UnprocessableEntityError('No accounting system is connected.')

    const result = await guard(
      async () => {
        throw refusal
      },
      'provider sync refused',
      meta
    )

    expect(result._unsafeUnwrapErr()).toBe(refusal)
    expect(h.error).not.toHaveBeenCalled()
    expect(h.warn).toHaveBeenCalledWith('provider sync refused', {
      ...meta,
      error: 'No accounting system is connected.',
      errorName: refusal.name,
      statusCode: 422,
    })
  })

  it('logs an error and flattens a plain Error to Internal error', async () => {
    const result = await guard(
      async () => {
        throw new Error('socket hang up')
      },
      'provider sync failed',
      meta
    )

    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(AuxxError)
    expect(error.message).toBe('Internal error')
    expect(h.warn).not.toHaveBeenCalled()
    expect(h.error).toHaveBeenCalledTimes(1)
    expect(h.error.mock.calls[0]?.[0]).toBe('provider sync failed')
  })

  it('returns ok and logs nothing on success', async () => {
    const result = await guard(async () => 'walked', 'provider sync failed', meta)

    expect(result._unsafeUnwrap()).toBe('walked')
    expect(h.warn).not.toHaveBeenCalled()
    expect(h.error).not.toHaveBeenCalled()
  })
})
