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
const listCredentials = vi.fn()
const triggerAppEvent = vi.fn()
const findFirstAppInstallation = vi.fn()

vi.mock('@auxx/credentials/store', () => ({
  insertCredential: (input: unknown) => insertCredential(input),
  rotateSecrets: (...args: unknown[]) => rotateSecrets(...args),
  updateCredential: (...args: unknown[]) => updateCredential(...args),
  recordRefreshSuccess: (...args: unknown[]) => recordRefreshSuccess(...args),
  mergeSecretFields: (...args: unknown[]) => mergeSecretFields(...args),
  mergeSecrets: (...args: unknown[]) => mergeSecrets(...args),
  getCredential: (...args: unknown[]) => getCredential(...args),
  listCredentials: (input: unknown) => listCredentials(input),
}))

// loadDeclaredEvents reads the active deployment's catalog to gate connection-identify.
vi.mock('@auxx/database', () => ({
  database: {
    query: {
      AppInstallation: {
        findFirst: (...args: unknown[]) => findFirstAppInstallation(...args),
      },
    },
  },
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

vi.mock('../../installations/app-field-provisioning', () => ({
  reconcileInstallationAppFields: async () => ({
    created: 0,
    updated: 0,
    orphaned: 0,
    errors: [],
  }),
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
  listCredentials.mockReset().mockResolvedValue(ok([]))
  triggerAppEvent.mockReset().mockResolvedValue(ok({ result: undefined }))
  // Default: no declared events → identify gate off → today's plain-insert behavior.
  findFirstAppInstallation.mockReset().mockResolvedValue(undefined)
})

describe('saveAppConnection — secret/plain split', () => {
  it('encrypts secretFields under secrets.fields and keeps plain variables in metadata', async () => {
    const res = await saveAppConnection(...ARGS, {
      secretFields: { client_id: 'cid', client_secret: 'cs' },
      metadata: { connectionVariables: { account_number: 'acc-1' } },
    })

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-1', matchedExisting: false })
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

describe('saveAppConnection — connection-identify dedup', () => {
  // Gate on: active deployment declares the connection-identify handler.
  const withIdentifyHook = () =>
    findFirstAppInstallation.mockResolvedValue({
      currentDeployment: { catalog: { events: ['connection-identify'] } },
    })

  // triggerAppEvent serves the identify call with `identifier`; every other event
  // (connection-added) resolves to the neutral `{ result: undefined }`.
  const identifyReturns = (identifier: string | undefined) =>
    triggerAppEvent.mockImplementation((input: { eventType: string }) =>
      Promise.resolve(
        input.eventType === 'connection-identify'
          ? ok({ result: identifier === undefined ? {} : { identifier } })
          : ok({ result: undefined })
      )
    )

  it('app WITHOUT the hook inserts on every connect (no dedup)', async () => {
    // Default findFirst → no catalog events → gate off.
    await saveAppConnection(...ARGS, { accessToken: 'tok-a', metadata: { realmId: 'r1' } })
    await saveAppConnection(...ARGS, { accessToken: 'tok-b', metadata: { realmId: 'r1' } })

    expect(insertCredential).toHaveBeenCalledTimes(2)
    // No identify hook → no in-place update.
    expect(rotateSecrets).not.toHaveBeenCalled()
    // No connection-identify event was ever fired.
    const identifyCalls = triggerAppEvent.mock.calls.filter(
      (c) => (c[0] as { eventType: string }).eventType === 'connection-identify'
    )
    expect(identifyCalls).toHaveLength(0)
  })

  it('same identifier updates the existing row in place (no insert, no connection-added)', async () => {
    withIdentifyHook()
    identifyReturns('realm-1')
    // A row with this identity already exists in scope.
    listCredentials.mockResolvedValue(
      ok([{ id: 'cred-existing', metadata: { __identity: 'realm-1' } }])
    )

    const res = await saveAppConnection(...ARGS, {
      accessToken: 'fresh-tok',
      metadata: { realmId: 'realm-1' },
    })

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-existing', matchedExisting: true })
    // Update in place — tokens rotated, breaker reset, no new row.
    expect(insertCredential).not.toHaveBeenCalled()
    expect(rotateSecrets).toHaveBeenCalledWith(
      'cred-existing',
      'org-1',
      expect.objectContaining({ accessToken: 'fresh-tok' }),
      { expiresAt: null }
    )
    expect(recordRefreshSuccess).toHaveBeenCalledWith('cred-existing', 'org-1', { expiresAt: null })
    // __identity survives the metadata replacement so future connects keep matching.
    expect(updateCredential).toHaveBeenCalledWith('cred-existing', 'org-1', {
      metadata: expect.objectContaining({ __identity: 'realm-1' }),
    })
    // connection-added must NOT re-fire — setup already ran for this account.
    const addedCalls = triggerAppEvent.mock.calls.filter(
      (c) => (c[0] as { eventType: string }).eventType === 'connection-added'
    )
    expect(addedCalls).toHaveLength(0)
  })

  it('different identifier inserts a new row and persists __identity', async () => {
    withIdentifyHook()
    identifyReturns('realm-2')
    // Existing row carries a different identity → no match.
    listCredentials.mockResolvedValue(
      ok([{ id: 'cred-existing', metadata: { __identity: 'realm-1' } }])
    )

    const res = await saveAppConnection(...ARGS, {
      accessToken: 'tok',
      metadata: { realmId: 'realm-2' },
    })

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-1', matchedExisting: false })
    expect(insertCredential).toHaveBeenCalledTimes(1)
    const inserted = insertCredential.mock.calls[0]![0] as { metadata: Record<string, unknown> }
    expect(inserted.metadata.__identity).toBe('realm-2')
    // connection-added fires for a genuinely new connection.
    const addedCalls = triggerAppEvent.mock.calls.filter(
      (c) => (c[0] as { eventType: string }).eventType === 'connection-added'
    )
    expect(addedCalls).toHaveLength(1)
  })

  it('empty identifier falls back to a plain insert (no __identity stored)', async () => {
    withIdentifyHook()
    identifyReturns('') // handler opts out of dedup for this connect
    listCredentials.mockResolvedValue(ok([]))

    const res = await saveAppConnection(...ARGS, {
      accessToken: 'tok',
      metadata: { realmId: '' },
    })

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-1', matchedExisting: false })
    expect(insertCredential).toHaveBeenCalledTimes(1)
    const inserted = insertCredential.mock.calls[0]![0] as { metadata: Record<string, unknown> }
    expect(inserted.metadata.__identity).toBeUndefined()
  })

  it('same identifier in a different scope stays a separate row (scope isolation)', async () => {
    withIdentifyHook()
    identifyReturns('realm-1')
    // The identity match query is scoped by userId — an org-scoped row (userId: null)
    // carrying this identity is invisible to a user-scoped connect.
    listCredentials.mockImplementation((input: { userId: string | null }) =>
      Promise.resolve(
        input.userId === null
          ? ok([{ id: 'cred-org', metadata: { __identity: 'realm-1' }, isDefault: true }])
          : ok([])
      )
    )

    // User-scoped connect (createdById 'user-1', userId 'user-1').
    const res = await saveAppConnection('app-1', 'inst-1', 'FedEx', 'org-1', 'user-1', 'user-1', {
      accessToken: 'tok',
      metadata: { realmId: 'realm-1' },
    })

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-1', matchedExisting: false })
    expect(insertCredential).toHaveBeenCalledTimes(1)
  })
})
