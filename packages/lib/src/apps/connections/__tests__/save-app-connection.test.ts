// packages/lib/src/apps/connections/__tests__/save-app-connection.test.ts
//
// The storage split: secret-flagged connection variables encrypt under `secrets.fields`,
// plain ones ride in plaintext metadata — on create, reconnect rotation, and in the
// `connection-added` event payload.

import { err, ok } from 'neverthrow'
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

/** Gate on: the active deployment declares the connection-identify handler. */
const withIdentifyHook = () =>
  findFirstAppInstallation.mockResolvedValue({
    currentDeployment: { catalog: { events: ['connection-identify'] } },
  })

/**
 * triggerAppEvent serves the identify call with `identifier`; every other event
 * (connection-added) resolves to the neutral `{ result: undefined }`.
 */
const identifyReturns = (identifier: string | undefined) =>
  triggerAppEvent.mockImplementation((input: { eventType: string }) =>
    Promise.resolve(
      input.eventType === 'connection-identify'
        ? ok({ result: identifier === undefined ? {} : { identifier } })
        : ok({ result: undefined })
    )
  )

/** The identify events fired during a case. */
const identifyCalls = () =>
  triggerAppEvent.mock.calls.filter(
    (c) => (c[0] as { eventType: string }).eventType === 'connection-identify'
  )

describe('saveAppConnection — connection-identify dedup', () => {
  it('app WITHOUT the hook inserts on every connect (no dedup)', async () => {
    // Default findFirst → no catalog events → gate off.
    await saveAppConnection(...ARGS, { accessToken: 'tok-a', metadata: { realmId: 'r1' } })
    await saveAppConnection(...ARGS, { accessToken: 'tok-b', metadata: { realmId: 'r1' } })

    expect(insertCredential).toHaveBeenCalledTimes(2)
    // No identify hook → no in-place update.
    expect(rotateSecrets).not.toHaveBeenCalled()
    // No connection-identify event was ever fired.
    expect(identifyCalls()).toHaveLength(0)
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

/**
 * The reconnect guard (plans/accounting/tasks/24-the-company-on-the-entry.md §3).
 *
 * A reconnect keeps the credential id, and connection-scoped `CustomField` rows are keyed
 * on that id. So a reconnect that lands on a DIFFERENT provider account leaves every stored
 * mapping in place and silently reinterprets it against a stranger - on QuickBooks, 96
 * account ids read against another company, where ids are per-company sequences and the
 * misposted entry still balances. These cases pin the four outcomes: refuse on a mismatch
 * WITHOUT writing anything, proceed on a match while re-stamping `__identity`, and proceed
 * whenever the app cannot answer.
 */
describe('saveAppConnection — reconnect identity guard', () => {
  const RECONNECT = { connectionId: 'cred-1' } as const
  const FRESH_TOKENS = { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }

  /** Point the stored row's `metadata.__identity` at one account for the duration of a case. */
  const storedIdentityIs = (identity: string | undefined, label?: string) =>
    getCredential.mockResolvedValue(
      ok({ label: label ?? null, metadata: identity === undefined ? {} : { __identity: identity } })
    )

  /** Every write door `saveAppConnection` could reach. A refusal must touch none of them. */
  const expectNothingWritten = () => {
    expect(rotateSecrets).not.toHaveBeenCalled()
    expect(mergeSecretFields).not.toHaveBeenCalled()
    expect(mergeSecrets).not.toHaveBeenCalled()
    expect(updateCredential).not.toHaveBeenCalled()
    expect(recordRefreshSuccess).not.toHaveBeenCalled()
    expect(insertCredential).not.toHaveBeenCalled()
  }

  it('a matching identity proceeds and re-stamps __identity onto the replaced metadata', async () => {
    withIdentifyHook()
    identifyReturns('realm-1')
    storedIdentityIs('realm-1')

    const res = await saveAppConnection(
      ...ARGS,
      { ...FRESH_TOKENS, metadata: { scope: 'read' } },
      RECONNECT
    )

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-1', matchedExisting: false })
    expect(rotateSecrets).toHaveBeenCalledWith(
      'cred-1',
      'org-1',
      expect.objectContaining({ accessToken: 'fresh-access' }),
      { expiresAt: null }
    )
    // An OAuth mint REPLACES metadata wholesale, so without the re-stamp `__identity` is
    // deleted here - and a later fresh connect to the same account mints a duplicate row.
    expect(updateCredential).toHaveBeenCalledWith('cred-1', 'org-1', {
      metadata: { scope: 'read', __identity: 'realm-1' },
    })
  })

  it('a row with no stored identity proceeds and gains one', async () => {
    withIdentifyHook()
    identifyReturns('realm-1')
    storedIdentityIs(undefined)

    const res = await saveAppConnection(...ARGS, { ...FRESH_TOKENS }, RECONNECT)

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-1', matchedExisting: false })
    expect(updateCredential).toHaveBeenCalledWith('cred-1', 'org-1', {
      metadata: { __identity: 'realm-1' },
    })
  })

  it('a DIFFERENT identity refuses, names the connected account, and rotates nothing', async () => {
    withIdentifyHook()
    identifyReturns('realm-2')
    storedIdentityIs('realm-1', 'Sandbox Company_US_1')

    const res = await saveAppConnection(...ARGS, { ...FRESH_TOKENS }, RECONNECT)

    expect(res.isErr()).toBe(true)
    // An AuxxError subclass, so `auxxErrorMiddleware` maps it to a 409 rather than a 500.
    const error = res._unsafeUnwrapErr() as { name?: string; statusCode?: number; message: string }
    expect(error.name).toBe('ConflictError')
    expect(error.statusCode).toBe(409)
    // The LABEL, which is the app's own name for the account and what the row already
    // reads as on the connections list.
    expect(error.message).toContain('Sandbox Company_US_1')
    // 🛑 Neither raw identity reaches the person. They are realm ids and numeric account
    // ids: fine in the warn log, nothing anybody can act on. Task 24 §4 draws the same
    // line for the ledger's deep link.
    expect(error.message).not.toContain('realm-1')
    expect(error.message).not.toContain('realm-2')
    // The message has to be the whole instruction - the OAuth callback surfaces it verbatim.
    expect(error.message).toContain('Disconnect this connection first')
    expectNothingWritten()
  })

  it('falls back to the raw identity when the app left the label empty', async () => {
    withIdentifyHook()
    identifyReturns('realm-2')
    storedIdentityIs('realm-1')

    const res = await saveAppConnection(...ARGS, { ...FRESH_TOKENS }, RECONNECT)

    // Naming something beats naming nothing; only the connected side is ever named.
    expect((res._unsafeUnwrapErr() as { message: string }).message).toContain('realm-1')
    expectNothingWritten()
  })

  it('an app that declares no identify handler reconnects unguarded', async () => {
    // Default findFirst → no catalog events → gate off. This is the pre-existing behavior
    // and it stays: most apps declare no handler and reconnect must keep working for them.
    storedIdentityIs('realm-1')

    const res = await saveAppConnection(...ARGS, { ...FRESH_TOKENS }, RECONNECT)

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-1', matchedExisting: false })
    expect(identifyCalls()).toHaveLength(0)
    expect(rotateSecrets).toHaveBeenCalled()
  })

  it('a THROWING identify handler proceeds - reconnect is the repair path for a dead token', async () => {
    withIdentifyHook()
    triggerAppEvent.mockRejectedValue(new Error('app Lambda is down'))
    storedIdentityIs('realm-1')

    const res = await saveAppConnection(...ARGS, { ...FRESH_TOKENS }, RECONNECT)

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-1', matchedExisting: false })
    expect(rotateSecrets).toHaveBeenCalled()
  })

  it('an identify handler returning an ERROR result proceeds', async () => {
    withIdentifyHook()
    triggerAppEvent.mockResolvedValue(err(new Error('handler returned 500')))
    storedIdentityIs('realm-1')

    const res = await saveAppConnection(...ARGS, { ...FRESH_TOKENS }, RECONNECT)

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-1', matchedExisting: false })
    expect(rotateSecrets).toHaveBeenCalled()
  })

  it('an EMPTY identifier proceeds without stamping anything', async () => {
    withIdentifyHook()
    identifyReturns('') // the app opted out of identity for this connect
    storedIdentityIs('realm-1')

    const res = await saveAppConnection(...ARGS, { ...FRESH_TOKENS }, RECONNECT)

    expect(res._unsafeUnwrap()).toEqual({ credentialId: 'cred-1', matchedExisting: false })
    expect(updateCredential).toHaveBeenCalledWith('cred-1', 'org-1', { metadata: {} })
  })
})
