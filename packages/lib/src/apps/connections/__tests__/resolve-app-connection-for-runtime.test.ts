// packages/lib/src/apps/connections/__tests__/resolve-app-connection-for-runtime.test.ts
//
// The credential store, database, and the lazy refresh helper are mocked; the tests assert the
// reveal → ensure-fresh → re-reveal decision tree on the direct-connectionId branch.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ensureFresh = vi.fn()
const revealCalls: string[] = []
let revealQueue: unknown[] = []
const connDef = { value: { connectionType: 'oauth2-code' } as Record<string, unknown> | null }

vi.mock('../../../credentials/ensure-fresh-credential-token', () => ({
  ensureFreshCredentialToken: (input: unknown) => ensureFresh(input),
}))

vi.mock('@auxx/credentials/store', () => ({
  revealSecrets: async (id: string) => {
    revealCalls.push(id)
    return revealQueue.shift()
  },
  findCredential: async () => ok(null),
}))

vi.mock('@auxx/services/app-connections', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  // Mirrors the real merge: plain metadata variables, secret fields win on collision.
  mergeConnectionVariables: (
    metadata: { connectionVariables?: Record<string, string> } | null | undefined,
    secrets: { fields?: Record<string, string> } | null | undefined
  ) => ({ ...(metadata?.connectionVariables ?? {}), ...(secrets?.fields ?? {}) }),
}))

vi.mock('@auxx/services/shared/utils', () => ({
  fromDatabase: async (p: Promise<unknown>) => ok(await p),
}))

vi.mock('@auxx/database', () => ({
  database: {
    query: { ConnectionDefinition: { findFirst: async () => connDef.value } },
  },
}))

import { resolveAppConnectionForRuntime } from '../resolve-app-connection-for-runtime'

function record(over: Record<string, unknown> = {}) {
  return {
    id: 'c',
    kind: 'app',
    userId: null,
    metadata: { foo: 1 },
    expiresAt: new Date(Date.now() + 30_000),
    lastRefreshAt: new Date(Date.now() - 3_570_000),
    createdAt: new Date(Date.now() - 3_600_000),
    ...over,
  }
}

const base = { appId: 'a', organizationId: 'o', userId: 'u', connectionId: 'c' }

beforeEach(() => {
  ensureFresh.mockReset()
  revealCalls.length = 0
  revealQueue = []
  connDef.value = { connectionType: 'oauth2-code' }
})

describe('resolveAppConnectionForRuntime — lazy refresh', () => {
  it('refreshes and re-reveals an oauth2 connection inside the skew window', async () => {
    ensureFresh.mockResolvedValue(true)
    revealQueue = [
      ok({ record: record(), secrets: { accessToken: 'old', refreshToken: 'r1' } }),
      ok({ record: record(), secrets: { accessToken: 'new', refreshToken: 'r2' } }),
    ]

    const res = await resolveAppConnectionForRuntime(base)

    expect(ensureFresh).toHaveBeenCalledTimes(1)
    expect(revealCalls).toEqual(['c', 'c']) // initial reveal + re-reveal after rotation
    expect(res._unsafeUnwrap().organizationConnection?.value).toBe('new')
  })

  it('does a single reveal when the token is fresh (no rotation)', async () => {
    ensureFresh.mockResolvedValue(false)
    revealQueue = [ok({ record: record(), secrets: { accessToken: 'tok', refreshToken: 'r1' } })]

    const res = await resolveAppConnectionForRuntime(base)

    expect(ensureFresh).toHaveBeenCalledTimes(1)
    expect(revealCalls).toEqual(['c']) // no re-reveal
    expect(res._unsafeUnwrap().organizationConnection?.value).toBe('tok')
  })

  it('never calls ensure-fresh for a secret-type connection', async () => {
    connDef.value = { connectionType: 'secret' }
    revealQueue = [ok({ record: record(), secrets: { secret: 'sk' } })]

    const res = await resolveAppConnectionForRuntime(base)

    expect(ensureFresh).not.toHaveBeenCalled()
    expect(revealCalls).toEqual(['c'])
    expect(res._unsafeUnwrap().organizationConnection?.type).toBe('secret')
  })

  it('skips the refresh entirely when ensureFresh: false', async () => {
    revealQueue = [ok({ record: record(), secrets: { accessToken: 'tok', refreshToken: 'r1' } })]

    await resolveAppConnectionForRuntime({ ...base, ensureFresh: false })

    expect(ensureFresh).not.toHaveBeenCalled()
    expect(revealCalls).toEqual(['c'])
  })
})

describe('resolveAppConnectionForRuntime — connection fields', () => {
  it('merges plain metadata variables with decrypted secret fields (secrets win)', async () => {
    connDef.value = { connectionType: 'secret' }
    revealQueue = [
      ok({
        record: record({
          metadata: { connectionVariables: { account: 'acc-1', client_id: 'meta' } },
        }),
        secrets: { fields: { client_id: 'cid', client_secret: 'cs' } },
      }),
    ]

    const res = await resolveAppConnectionForRuntime(base)

    const conn = res._unsafeUnwrap().organizationConnection
    expect(conn?.fields).toEqual({ account: 'acc-1', client_id: 'cid', client_secret: 'cs' })
    expect(conn?.value).toBe('') // multi-field connections carry no single value
  })

  it('leaves fields undefined when the connection has no variables', async () => {
    connDef.value = { connectionType: 'secret' }
    revealQueue = [ok({ record: record(), secrets: { secret: 'sk' } })]

    const res = await resolveAppConnectionForRuntime(base)

    const conn = res._unsafeUnwrap().organizationConnection
    expect(conn?.fields).toBeUndefined()
    expect(conn?.value).toBe('sk')
  })

  it('a secret field literally named "secret" stays isolated from the reserved key', async () => {
    connDef.value = { connectionType: 'secret' }
    revealQueue = [
      ok({ record: record(), secrets: { secret: 'top-level', fields: { secret: 'nested' } } }),
    ]

    const res = await resolveAppConnectionForRuntime(base)

    const conn = res._unsafeUnwrap().organizationConnection
    expect(conn?.value).toBe('top-level')
    expect(conn?.fields).toEqual({ secret: 'nested' })
  })

  it('threads the definition authApply spec onto the resolved connection', async () => {
    connDef.value = {
      connectionType: 'secret',
      authApply: { in: 'header', name: 'Authorization', format: 'Bearer {value}' },
    }
    revealQueue = [ok({ record: record(), secrets: { secret: 'sk' } })]

    const res = await resolveAppConnectionForRuntime(base)

    expect(res._unsafeUnwrap().organizationConnection?.authApply).toEqual({
      in: 'header',
      name: 'Authorization',
      format: 'Bearer {value}',
    })
  })
})
