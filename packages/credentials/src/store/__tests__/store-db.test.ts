// packages/credentials/src/store/__tests__/store-db.test.ts
//
// No DB harness exists (project_drizzle_columns_undefined_in_vitest), so @auxx/database is
// mocked with a chainable builder and the tests assert call shapes + real-crypto round-trips.
// Crypto is the REAL secret box (env keys stubbed), so encrypt→store→decrypt is exercised end to end.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectRows: [] as Record<string, unknown>[],
  writeReturning: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
}

function selectBuilder() {
  const builder: Record<string, unknown> = {}
  for (const m of ['from', 'where', 'orderBy', 'leftJoin', 'limit']) {
    builder[m] = () => builder
  }
  // Thenable: awaiting any point in the chain resolves to the configured rows.
  builder.then = (onF: (rows: unknown) => unknown) => Promise.resolve(state.selectRows).then(onF)
  return builder
}

vi.mock('@auxx/database', () => {
  const database = {
    select: () => selectBuilder(),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.inserted.push(values)
        return { returning: async () => state.writeReturning }
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updated.push(values)
        return { where: () => ({ returning: async () => state.writeReturning }) }
      },
    }),
    delete: () => ({
      where: () => ({ returning: async () => state.writeReturning }),
    }),
  }
  return { database, schema: { Credential: {}, User: {} } }
})

import { decryptSecrets, encryptSecrets } from '../../crypto'
import { insertCredential } from '../insert-credential'
import { mergeSecretFields } from '../merge-secret-fields'
import { mergeSecrets } from '../merge-secrets'
import { recordRefreshFailure } from '../record-refresh'
import { revealSecrets } from '../reveal-secrets'
import { rotateSecrets } from '../rotate-secrets'

beforeEach(() => {
  vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'a'.repeat(64))
  state.selectRows = []
  state.writeReturning = []
  state.inserted = []
  state.updated = []
})

describe('insertCredential', () => {
  it('encrypts secrets to v2, stores metadata as plaintext, and passes kind/type', async () => {
    state.writeReturning = [{ id: 'cred-1' }]
    const result = await insertCredential({
      organizationId: 'org-1',
      kind: 'app',
      appId: 'app-1',
      name: 'Gmail',
      secrets: { accessToken: 'tok', refreshToken: 'ref' },
      metadata: { scopes: 'read', accountEmail: 'a@b.com' },
    })
    expect(result.isOk()).toBe(true)
    const row = state.inserted[0]!
    expect(row.kind).toBe('app')
    expect(row.type).toBeNull()
    expect(typeof row.encryptedSecrets).toBe('string')
    expect((row.encryptedSecrets as string).startsWith('v2:')).toBe(true)
    expect(row.metadata).toEqual({ scopes: 'read', accountEmail: 'a@b.com' }) // plaintext
    // Round-trip: the stored blob decrypts back to the input secrets.
    expect(decryptSecrets(row.encryptedSecrets as string)).toEqual({
      accessToken: 'tok',
      refreshToken: 'ref',
    })
  })
})

describe('revealSecrets', () => {
  it('decrypts the stored blob and returns a record without encryptedSecrets', async () => {
    state.selectRows = [
      {
        id: 'cred-1',
        organizationId: 'org-1',
        kind: 'connection',
        metadata: { foo: 'bar' },
        encryptedSecrets: encryptSecrets({ token: 'xyz' }),
      },
    ]
    const result = await revealSecrets('cred-1', 'org-1')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.secrets).toEqual({ token: 'xyz' })
      expect('encryptedSecrets' in result.value.record).toBe(false)
      expect(result.value.record.metadata).toEqual({ foo: 'bar' })
    }
  })

  it('returns CREDENTIAL_NOT_FOUND for a missing/other-org row', async () => {
    state.selectRows = []
    const result = await revealSecrets('nope', 'org-1')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('CREDENTIAL_NOT_FOUND')
  })
})

describe('mergeSecrets', () => {
  it('keeps existing values for blank/undefined fields and overwrites the rest', async () => {
    state.selectRows = [{ encryptedSecrets: encryptSecrets({ apiKey: 'old', host: 'h1' }) }]
    state.writeReturning = [{ id: 'cred-1' }]
    const result = await mergeSecrets('cred-1', 'org-1', { apiKey: '', host: 'h2', extra: 'new' })
    expect(result.isOk()).toBe(true)
    const written = state.updated[0]!.encryptedSecrets as string
    expect(decryptSecrets(written)).toEqual({ apiKey: 'old', host: 'h2', extra: 'new' })
  })
})

describe('mergeSecretFields', () => {
  it('merges into the nested `fields` bag, keeping siblings and untouched fields', async () => {
    state.selectRows = [
      {
        encryptedSecrets: encryptSecrets({
          secret: 'bare',
          fields: { apiKey: 'old', host: 'h1' },
        }),
      },
    ]
    state.writeReturning = [{ id: 'cred-1' }]
    // Edit only `host`; `apiKey` left blank (keep) and the top-level `secret` sibling untouched.
    const result = await mergeSecretFields('cred-1', 'org-1', { apiKey: '', host: 'h2' })
    expect(result.isOk()).toBe(true)
    expect(decryptSecrets(state.updated[0]!.encryptedSecrets as string)).toEqual({
      secret: 'bare',
      fields: { apiKey: 'old', host: 'h2' },
    })
  })

  it('round-trips byte-identical when every field is left blank (untouched submit)', async () => {
    const original = encryptSecrets({ fields: { apiKey: 'keepme', host: 'h1' } })
    state.selectRows = [{ encryptedSecrets: original }]
    state.writeReturning = [{ id: 'cred-1' }]
    const result = await mergeSecretFields('cred-1', 'org-1', { apiKey: '', host: '' })
    expect(result.isOk()).toBe(true)
    expect(decryptSecrets(state.updated[0]!.encryptedSecrets as string)).toEqual({
      fields: { apiKey: 'keepme', host: 'h1' },
    })
  })
})

describe('rotateSecrets', () => {
  it('fully replaces secrets and reports not-found when no row matches', async () => {
    state.writeReturning = [{ id: 'cred-1' }]
    const ok = await rotateSecrets('cred-1', 'org-1', { accessToken: 'fresh' })
    expect(ok.isOk()).toBe(true)
    expect(decryptSecrets(state.updated[0]!.encryptedSecrets as string)).toEqual({
      accessToken: 'fresh',
    })

    state.writeReturning = []
    const missing = await rotateSecrets('cred-x', 'org-1', { accessToken: 'fresh' })
    expect(missing.isErr()).toBe(true)
    if (missing.isErr()) expect(missing.error.code).toBe('CREDENTIAL_NOT_FOUND')
  })
})

describe('recordRefreshFailure', () => {
  it('stamps the failure time and increments the breaker', async () => {
    state.writeReturning = [{ id: 'cred-1' }]
    const result = await recordRefreshFailure('cred-1', 'org-1')
    expect(result.isOk()).toBe(true)
    const set = state.updated[0]!
    expect(set.lastRefreshFailureAt).toBeInstanceOf(Date)
    expect(set.consecutiveRefreshFailures).toBeDefined() // SQL increment expression
  })
})
