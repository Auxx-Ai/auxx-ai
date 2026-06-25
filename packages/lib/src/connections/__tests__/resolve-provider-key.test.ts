// packages/lib/src/connections/__tests__/resolve-provider-key.test.ts
//
// resolveProviderKey replaces the denormalized Credential.type read: providerKey comes from the
// joined ConnectionDefinition. App/MCP defs (no providerKey) and FK-less legacy rows resolve to
// null/omitted; the batch variant resolves a set in one query with no N+1.

import { describe, expect, it, vi } from 'vitest'
import { resolveProviderKey, resolveProviderKeys } from '../resolve-provider-key'

function fakeDb(opts: { findFirst?: () => unknown; findMany?: () => unknown[] }) {
  const findMany = vi.fn(async () => opts.findMany?.() ?? [])
  return {
    db: {
      query: {
        ConnectionDefinition: {
          findFirst: async () => opts.findFirst?.() ?? undefined,
          findMany,
        },
      },
    } as never,
    findMany,
  }
}

describe('resolveProviderKey — single', () => {
  it('returns the definition providerKey when the FK is set', async () => {
    const { db } = fakeDb({ findFirst: () => ({ providerKey: 'gmail' }) })
    expect(await resolveProviderKey(db, { connectionDefinitionId: 'def-1' })).toBe('gmail')
  })

  it('returns null when the credential has no definition FK (no query)', async () => {
    const { db } = fakeDb({ findFirst: () => ({ providerKey: 'gmail' }) })
    expect(await resolveProviderKey(db, { connectionDefinitionId: null })).toBeNull()
  })

  it('returns null when the definition has no providerKey (app/mcp owner)', async () => {
    const { db } = fakeDb({ findFirst: () => ({ providerKey: null }) })
    expect(await resolveProviderKey(db, { connectionDefinitionId: 'def-app' })).toBeNull()
  })

  it('returns null when the definition is gone', async () => {
    const { db } = fakeDb({ findFirst: () => undefined })
    expect(await resolveProviderKey(db, { connectionDefinitionId: 'def-missing' })).toBeNull()
  })
})

describe('resolveProviderKeys — batch', () => {
  it('keys providerKey by credentialId via a single query over distinct def ids', async () => {
    const { db, findMany } = fakeDb({
      findMany: () => [
        { id: 'def-1', providerKey: 'gmail' },
        { id: 'def-2', providerKey: 'openaiApi' },
      ],
    })
    const map = await resolveProviderKeys(db, [
      { id: 'cred-a', connectionDefinitionId: 'def-1' },
      { id: 'cred-b', connectionDefinitionId: 'def-2' },
      { id: 'cred-c', connectionDefinitionId: 'def-1' }, // shares def-1
    ])

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(map.get('cred-a')).toBe('gmail')
    expect(map.get('cred-b')).toBe('openaiApi')
    expect(map.get('cred-c')).toBe('gmail')
  })

  it('omits FK-less rows and never queries when nothing has a FK', async () => {
    const { db, findMany } = fakeDb({ findMany: () => [] })
    const map = await resolveProviderKeys(db, [{ id: 'cred-a', connectionDefinitionId: null }])
    expect(findMany).not.toHaveBeenCalled()
    expect(map.size).toBe(0)
  })

  it('omits a credential whose def carries no providerKey (app/mcp)', async () => {
    const { db } = fakeDb({
      findMany: () => [{ id: 'def-app', providerKey: null }],
    })
    const map = await resolveProviderKeys(db, [
      { id: 'cred-app', connectionDefinitionId: 'def-app' },
    ])
    expect(map.has('cred-app')).toBe(false)
  })
})
