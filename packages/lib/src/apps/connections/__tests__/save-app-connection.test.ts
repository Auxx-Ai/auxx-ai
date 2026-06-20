// packages/lib/src/apps/connections/__tests__/save-app-connection.test.ts
//
// The storage split: secret-flagged connection variables encrypt under `secrets.fields`,
// plain ones ride in plaintext metadata — on create, reconnect rotation, and in the
// `connection-added` event payload.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertCredential = vi.fn()
const rotateSecrets = vi.fn()
const updateCredential = vi.fn()
const recordRefreshSuccess = vi.fn()
const mergeSecretFields = vi.fn()
const mergeSecrets = vi.fn()
const getCredential = vi.fn()
const triggerAppEvent = vi.fn()

vi.mock('@auxx/credentials/store', () => ({
  insertCredential: (input: unknown) => insertCredential(input),
  rotateSecrets: (...args: unknown[]) => rotateSecrets(...args),
  updateCredential: (...args: unknown[]) => updateCredential(...args),
  recordRefreshSuccess: (...args: unknown[]) => recordRefreshSuccess(...args),
  mergeSecretFields: (...args: unknown[]) => mergeSecretFields(...args),
  mergeSecrets: (...args: unknown[]) => mergeSecrets(...args),
  getCredential: (...args: unknown[]) => getCredential(...args),
  listCredentials: async () => ok([]),
}))

vi.mock('@auxx/services/app-connections', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  mergeConnectionVariables: (
    metadata: { connectionVariables?: Record<string, string> } | null | undefined,
    secrets: { fields?: Record<string, string> } | null | undefined
  ) => ({ ...(metadata?.connectionVariables ?? {}), ...(secrets?.fields ?? {}) }),
  renameAppConnection: async () => ok(undefined),
  safeSerializeMetadata: (m: unknown) => m,
}))

vi.mock('@auxx/services/custom-fields', () => ({
  getInstallationCatalog: async () => ({}),
  provisionAppFields: async () => undefined,
}))

vi.mock('../../events', () => ({
  triggerAppEvent: (input: unknown) => triggerAppEvent(input),
}))

vi.mock('../../installations/resolve-active-installation', () => ({
  resolveActiveInstallationId: async () => ok('inst-1'),
}))

import { saveAppConnection } from '../save-app-connection'

const ARGS = ['app-1', 'inst-1', 'FedEx', 'org-1', 'user-1', null] as const

beforeEach(() => {
  insertCredential.mockReset().mockResolvedValue(ok({ id: 'cred-1' }))
  rotateSecrets.mockReset().mockResolvedValue(ok(undefined))
  updateCredential.mockReset().mockResolvedValue(ok(undefined))
  recordRefreshSuccess.mockReset().mockResolvedValue(ok(undefined))
  mergeSecretFields.mockReset().mockResolvedValue(ok(undefined))
  mergeSecrets.mockReset().mockResolvedValue(ok(undefined))
  getCredential
    .mockReset()
    .mockResolvedValue(ok({ metadata: { connectionVariables: { account_number: 'acc-1' } } }))
  triggerAppEvent.mockReset().mockResolvedValue(ok({ result: undefined }))
})

describe('saveAppConnection — secret/plain split', () => {
  it('encrypts secretFields under secrets.fields and keeps plain variables in metadata', async () => {
    const res = await saveAppConnection(...ARGS, {
      secretFields: { client_id: 'cid', client_secret: 'cs' },
      metadata: { connectionVariables: { account_number: 'acc-1' } },
    })

    expect(res._unsafeUnwrap()).toBe('cred-1')
    const inserted = insertCredential.mock.calls[0]![0] as {
      secrets: Record<string, unknown>
      metadata: Record<string, unknown>
    }
    expect(inserted.secrets).toEqual({ fields: { client_id: 'cid', client_secret: 'cs' } })
    expect(inserted.metadata).toEqual({ connectionVariables: { account_number: 'acc-1' } })
  })

  it('a secret field named "secret" nests under fields without clobbering the reserved key', async () => {
    await saveAppConnection(...ARGS, {
      secret: 'api-key',
      secretFields: { secret: 'nested-value' },
    })

    const inserted = insertCredential.mock.calls[0]![0] as { secrets: Record<string, unknown> }
    expect(inserted.secrets).toEqual({
      secret: 'api-key',
      fields: { secret: 'nested-value' },
    })
  })

  it('manual secret reconnect MERGES (no token → never full-replaces, keeps untouched fields)', async () => {
    await saveAppConnection(
      ...ARGS,
      {
        secretFields: { client_secret: 'rotated' },
        metadata: { connectionVariables: { account_number: 'acc-2' } },
      },
      { connectionId: 'cred-1' }
    )

    expect(insertCredential).not.toHaveBeenCalled()
    // No accessToken/refreshToken → manual edit → merge, NOT rotateSecrets full-replace.
    expect(rotateSecrets).not.toHaveBeenCalled()
    expect(mergeSecretFields).toHaveBeenCalledWith('cred-1', 'org-1', { client_secret: 'rotated' })
    // Plain vars merge into the existing metadata bag (acc-1 → acc-2), not a wholesale replace.
    expect(updateCredential).toHaveBeenCalledWith('cred-1', 'org-1', {
      metadata: { connectionVariables: { account_number: 'acc-2' } },
    })
    // A successful re-auth clears the refresh circuit breaker so the connection no
    // longer surfaces as "expired" (see recordRefreshSuccess: consecutiveRefreshFailures → 0).
    expect(recordRefreshSuccess).toHaveBeenCalledWith('cred-1', 'org-1', { expiresAt: null })
  })

  it('OAuth mint reconnect (tokens present) full-replaces via rotateSecrets', async () => {
    await saveAppConnection(
      ...ARGS,
      {
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
        metadata: { scope: 'read' },
      },
      { connectionId: 'cred-1' }
    )

    expect(rotateSecrets).toHaveBeenCalledWith(
      'cred-1',
      'org-1',
      { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' },
      { expiresAt: null }
    )
    expect(updateCredential).toHaveBeenCalledWith('cred-1', 'org-1', {
      metadata: { scope: 'read' },
    })
    expect(mergeSecretFields).not.toHaveBeenCalled()
    expect(recordRefreshSuccess).toHaveBeenCalledWith('cred-1', 'org-1', { expiresAt: null })
  })

  it('hands the merged fields map to the connection-added handler', async () => {
    await saveAppConnection(...ARGS, {
      secretFields: { client_id: 'cid' },
      metadata: { connectionVariables: { account_number: 'acc-1' } },
    })

    const event = triggerAppEvent.mock.calls[0]![0] as {
      payload: { connection: { value: string; fields?: Record<string, string> } }
    }
    expect(event.payload.connection.fields).toEqual({
      account_number: 'acc-1',
      client_id: 'cid',
    })
    expect(event.payload.connection.value).toBe('')
  })

  it('single-secret connections are unchanged (no fields key anywhere)', async () => {
    await saveAppConnection(...ARGS, { secret: 'sk' })

    const inserted = insertCredential.mock.calls[0]![0] as { secrets: Record<string, unknown> }
    expect(inserted.secrets).toEqual({ secret: 'sk' })
    const event = triggerAppEvent.mock.calls[0]![0] as {
      payload: { connection: Record<string, unknown> }
    }
    expect(event.payload.connection.fields).toBeUndefined()
    expect(event.payload.connection.value).toBe('sk')
  })
})
