// packages/lib/src/connections/__tests__/save-connection.test.ts
//
// saveConnection is the platform-owner persist: it must write a row the runtime resolver can
// find — `kind:'workflow'`, `type:<providerKey>`, the `connectionDefinitionId` FK — split secrets
// from plaintext metadata, and on reconnect rotate-in-place + reset the refresh circuit breaker.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertCredential = vi.fn()
const rotateSecrets = vi.fn()
const updateCredential = vi.fn()
const recordRefreshSuccess = vi.fn()
const listCredentials = vi.fn()

vi.mock('@auxx/credentials/store', () => ({
  insertCredential: (input: unknown) => insertCredential(input),
  rotateSecrets: (...args: unknown[]) => rotateSecrets(...args),
  updateCredential: (...args: unknown[]) => updateCredential(...args),
  recordRefreshSuccess: (...args: unknown[]) => recordRefreshSuccess(...args),
  listCredentials: (input: unknown) => listCredentials(input),
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}))

import { saveConnection } from '../save-connection'

const BASE = {
  connectionDefinitionId: 'def-1',
  providerKey: 'googleOAuth2Api',
  name: 'Google',
  organizationId: 'org-1',
  createdById: 'user-1',
} as const

beforeEach(() => {
  insertCredential.mockReset().mockResolvedValue(ok({ id: 'cred-1' }))
  rotateSecrets.mockReset().mockResolvedValue(ok(undefined))
  updateCredential.mockReset().mockResolvedValue(ok(undefined))
  recordRefreshSuccess.mockReset().mockResolvedValue(ok(undefined))
  listCredentials.mockReset().mockResolvedValue(ok([]))
})

describe('saveConnection — platform-owner persist', () => {
  it('inserts a kind:workflow row typed by providerKey and linked to its definition', async () => {
    const res = await saveConnection({
      ...BASE,
      userId: 'user-1', // per-user (def.global === false)
      connectionData: {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: '2030-01-01T00:00:00.000Z',
        metadata: { scope: 'email' },
      },
    })

    expect(res._unsafeUnwrap()).toBe('cred-1')
    const inserted = insertCredential.mock.calls[0]![0]
    expect(inserted).toMatchObject({
      kind: 'workflow',
      type: 'googleOAuth2Api',
      connectionDefinitionId: 'def-1',
      organizationId: 'org-1',
      createdById: 'user-1',
      userId: 'user-1',
      name: 'Google',
      label: 'Google',
    })
    expect(inserted.secrets).toEqual({ accessToken: 'at', refreshToken: 'rt' })
    expect(inserted.metadata).toEqual({ scope: 'email' })
    expect(inserted.expiresAt).toEqual(new Date('2030-01-01T00:00:00.000Z'))
  })

  it('org-scoped connection (def.global) persists userId: null', async () => {
    await saveConnection({
      ...BASE,
      userId: null,
      connectionData: { secret: 'api-key' },
    })

    expect(insertCredential.mock.calls[0]![0]).toMatchObject({ userId: null })
  })

  it('splits secret-flagged variables under secrets.fields, keeping plain ones in metadata', async () => {
    await saveConnection({
      ...BASE,
      userId: null,
      connectionData: {
        accessToken: 'at',
        secretFields: { client_secret: 'cs' },
        metadata: { connectionVariables: { shop: 'acme' } },
      },
    })

    const inserted = insertCredential.mock.calls[0]![0]
    expect(inserted.secrets).toEqual({ accessToken: 'at', fields: { client_secret: 'cs' } })
    expect(inserted.metadata).toEqual({ connectionVariables: { shop: 'acme' } })
  })

  it('dedupes the label within (provider, scope)', async () => {
    listCredentials.mockResolvedValue(ok([{ label: 'Google' }, { label: 'Google (2)' }]))

    await saveConnection({
      ...BASE,
      userId: 'user-1',
      connectionData: { accessToken: 'at' },
    })

    expect(listCredentials).toHaveBeenCalledWith({
      organizationId: 'org-1',
      kind: 'workflow',
      type: 'googleOAuth2Api',
      userId: 'user-1',
    })
    expect(insertCredential.mock.calls[0]![0].label).toBe('Google (3)')
  })

  it('reconnect rotates in place + resets the breaker, never inserts', async () => {
    const res = await saveConnection({
      ...BASE,
      userId: 'user-1',
      connectionData: {
        accessToken: 'fresh',
        refreshToken: 'rt2',
        expiresAt: '2030-06-01T00:00:00.000Z',
        metadata: { scope: 'email' },
      },
      connectionId: 'cred-1',
    })

    expect(res._unsafeUnwrap()).toBe('cred-1')
    expect(insertCredential).not.toHaveBeenCalled()
    expect(rotateSecrets).toHaveBeenCalledWith(
      'cred-1',
      'org-1',
      { accessToken: 'fresh', refreshToken: 'rt2' },
      { expiresAt: new Date('2030-06-01T00:00:00.000Z') }
    )
    expect(updateCredential).toHaveBeenCalledWith('cred-1', 'org-1', {
      metadata: { scope: 'email' },
    })
    // A successful re-auth clears the refresh circuit breaker (consecutiveRefreshFailures → 0).
    expect(recordRefreshSuccess).toHaveBeenCalledWith('cred-1', 'org-1', {
      expiresAt: new Date('2030-06-01T00:00:00.000Z'),
    })
  })
})
