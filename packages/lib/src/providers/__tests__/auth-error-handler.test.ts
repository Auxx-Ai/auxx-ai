// packages/lib/src/providers/__tests__/auth-error-handler.test.ts
//
// Classification of provider auth errors — in particular that Google's 401
// ("Invalid Credentials" / UNAUTHENTICATED, the gaxios shape) maps to
// REVOKED_ACCESS with requiresReauth, so the credential gets flagged and the
// UI surfaces the Reconnect action instead of looping sync → throttle forever.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const reauthCalls: { integrationId: string; error: string; requiresReauth: boolean }[] = []

vi.mock('../credential-auth-state', () => ({
  markCredentialReauth: async (integrationId: string, error: string, requiresReauth: boolean) => {
    reauthCalls.push({ integrationId, error, requiresReauth })
  },
  clearCredentialReauth: async () => {},
}))

vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ metadata: {} }] }) }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
  schema: { Integration: { id: 'Integration.id', metadata: 'Integration.metadata' } },
}))
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}))

import { AuthErrorHandler, AuthErrorType } from '../auth-error-handler'

beforeEach(() => {
  reauthCalls.length = 0
})

describe('AuthErrorHandler (google)', () => {
  const handler = () => new AuthErrorHandler('google', 'int-1')

  it('classifies a gaxios 401 "Invalid Credentials" as revoked access requiring reauth', async () => {
    const details = await handler().handleAuthError(
      Object.assign(new Error('Invalid Credentials'), {
        response: { status: 401, data: {} },
      }),
      'getLabels'
    )

    expect(details.type).toBe(AuthErrorType.REVOKED_ACCESS)
    expect(details.requiresReauth).toBe(true)
    expect(details.retryable).toBe(false)
    expect(reauthCalls[0]).toMatchObject({ integrationId: 'int-1', requiresReauth: true })
  })

  it('classifies a numeric 401 code as revoked access', async () => {
    const details = await handler().handleAuthError(
      Object.assign(new Error('Request had invalid authentication credentials.'), { code: 401 }),
      'sync'
    )

    expect(details.type).toBe(AuthErrorType.REVOKED_ACCESS)
    expect(details.requiresReauth).toBe(true)
  })

  it('still classifies invalid_rapt as invalid grant requiring reauth', async () => {
    const details = await handler().handleAuthError(
      Object.assign(new Error('reauth related error (invalid_rapt)'), {
        response: { status: 400, data: { error_subtype: 'invalid_rapt' } },
      }),
      'refresh'
    )

    expect(details.type).toBe(AuthErrorType.INVALID_GRANT)
    expect(details.requiresReauth).toBe(true)
  })

  it('keeps rate limits retryable without reauth', async () => {
    const details = await handler().handleAuthError(new Error('rate_limit exceeded'), 'sync')

    expect(details.type).toBe(AuthErrorType.RATE_LIMITED)
    expect(details.requiresReauth).toBe(false)
    expect(details.retryable).toBe(true)
    expect(reauthCalls[0]).toMatchObject({ requiresReauth: false })
  })

  it('leaves unclassified provider errors retryable without reauth', async () => {
    const details = await handler().handleAuthError(new Error('backend blip'), 'sync')

    expect(details.type).toBe(AuthErrorType.PROVIDER_ERROR)
    expect(details.requiresReauth).toBe(false)
    expect(details.retryable).toBe(true)
  })
})
