// packages/lib/src/connections/__tests__/pending-selection.test.ts
//
// The pending-marker envelope. These assert on RENDERED SQL for the two writes, deliberately.
//
// The whole §4.4 design rests on one property: our writes MERGE into `Credential.metadata` rather
// than replacing it, because the OAuth bookkeeping the connections layer writes and the providers'
// own caches (`metadata.meta.pages`, `metadata.quo`) live in the same blob. A `.set({ metadata })`
// that looked correct in TypeScript would silently erase all of it, and no runtime assertion on a
// mocked driver would notice. Rendering the SQL is what makes the difference visible.
//
// The reverse guarantee does NOT hold and is not asserted here: `saveConnection` REPLACES the blob
// on an OAuth mint, so the marker survives only because the post-connect hook runs after it.

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captured: { sets: unknown[]; selects: unknown[] } = { sets: [], selects: [] }

/** Controllable per-test: what the superseded-credential reference check finds. */
const { integrationFindFirst, deleteCredential } = vi.hoisted(() => ({
  integrationFindFirst: vi.fn(async (): Promise<unknown> => undefined),
  deleteCredential: vi.fn(async () => ({ isErr: () => false })),
}))

vi.mock('@auxx/credentials/store', () => ({ deleteCredential }))

/** Rows the next `select()` chain resolves to. */
let selectRows: Array<Record<string, unknown>> = []

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// The REAL schema barrel (pure Drizzle, no connection) so the rendered SQL names real columns,
// paired with a hand-rolled `database` that records what it was handed.
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    for (const key of ['from', 'where', 'orderBy']) chain[key] = () => chain
    chain.limit = async () => selectRows
    // Awaited without `.limit()` (findPendingSelectionForUser ends on `.limit`, but keep both).
    chain.then = (resolve: (rows: unknown) => unknown) => resolve(selectRows)
    return chain
  }
  const updateChain = () => {
    const chain: Record<string, unknown> = {}
    chain.set = (values: unknown) => {
      captured.sets.push(values)
      return chain
    }
    chain.where = async () => undefined
    return chain
  }
  return {
    schema,
    database: {
      select: () => selectChain(),
      update: () => updateChain(),
      query: { Integration: { findFirst: integrationFindFirst } },
    },
  }
})

const {
  writePendingSelection,
  readPendingSelection,
  findPendingSelectionForUser,
  clearPendingSelection,
  deleteSupersededPendingCredentials,
} = await import('../pending-selection')

const dialect = new PgDialect()
const renderLastSet = () => {
  const values = captured.sets.at(-1) as { metadata?: unknown }
  return dialect.sqlToQuery(values?.metadata as never)
}

const ORG = 'org_1'
const CRED = 'cred_1'
const USER = 'usr_1'

const marker = {
  kind: 'social-page-selection' as const,
  providerKey: 'facebook',
  payload: { provider: 'facebook', candidateIds: ['page-1', 'page-2'] },
}

beforeEach(() => {
  captured.sets = []
  captured.selects = []
  selectRows = []
  integrationFindFirst.mockResolvedValue(undefined)
  deleteCredential.mockResolvedValue({ isErr: () => false })
})

describe('writePendingSelection', () => {
  it('MERGES into the existing metadata instead of replacing it', async () => {
    await writePendingSelection(CRED, ORG, marker)

    const { sql } = renderLastSet()
    // `COALESCE(metadata,'{}') || $json` — the `||` is the whole point. A plain assignment here
    // would drop `metadata.meta.pages` and every OAuth bookkeeping key on the row.
    expect(sql).toContain('COALESCE')
    expect(sql).toContain('||')
    expect(sql).toContain('"metadata"')
  })

  it('stamps createdAt when the caller does not supply one', async () => {
    await writePendingSelection(CRED, ORG, marker)

    const { params } = renderLastSet()
    const json = params.map(String).find((value) => value.includes('pendingSelection'))
    expect(json).toBeTruthy()
    const parsed = JSON.parse(json!)
    expect(parsed.pendingSelection.kind).toBe('social-page-selection')
    // The sort key `findPendingSelectionForUser` orders on — an unstamped marker would sort last
    // forever and lose to any older one.
    expect(typeof parsed.pendingSelection.createdAt).toBe('string')
  })
})

describe('clearPendingSelection', () => {
  it('removes ONLY the pendingSelection key', async () => {
    await clearPendingSelection(CRED, ORG)

    const { sql, params } = renderLastSet()
    // `jsonb - text` deletes one top-level key. A `.set({ metadata: {} })` would take the rest
    // of the blob with it.
    expect(sql).toContain('COALESCE')
    expect(sql).toMatch(/- \$\d+::text/)
    expect(params).toEqual(['pendingSelection'])
  })
})

describe('readPendingSelection', () => {
  it('reads a well-formed marker back', async () => {
    selectRows = [
      { metadata: { pendingSelection: { ...marker, createdAt: '2026-08-18T00:00:00.000Z' } } },
    ]

    const result = await readPendingSelection(CRED, ORG)

    expect(result).toMatchObject({ kind: 'social-page-selection', providerKey: 'facebook' })
  })

  it('answers null — never an error — for a credential in another org', async () => {
    // The org predicate is the AUTHORIZATION boundary here, not a filter: `credentialId` arrives
    // from the client. A foreign id simply matches no row.
    selectRows = []

    await expect(readPendingSelection(CRED, 'org_other')).resolves.toBeNull()
  })

  it('answers null for a credential that has no marker', async () => {
    selectRows = [{ metadata: { meta: { pages: [] } } }]

    await expect(readPendingSelection(CRED, ORG)).resolves.toBeNull()
  })
})

describe('findPendingSelectionForUser', () => {
  it('returns the row and its credential id', async () => {
    selectRows = [
      {
        id: CRED,
        metadata: { pendingSelection: { ...marker, createdAt: '2026-08-18T00:00:00.000Z' } },
      },
    ]

    const found = await findPendingSelectionForUser(ORG, USER)

    expect(found).toMatchObject({ credentialId: CRED })
  })

  it('skips rows whose marker is malformed rather than returning a broken one', async () => {
    selectRows = [{ id: 'cred_bad', metadata: { pendingSelection: { kind: 'x' } } }]

    await expect(findPendingSelectionForUser(ORG, USER)).resolves.toBeNull()
  })

  it('filters by kind when asked', async () => {
    selectRows = [
      {
        id: CRED,
        metadata: { pendingSelection: { ...marker, createdAt: '2026-08-18T00:00:00.000Z' } },
      },
    ]

    await expect(
      findPendingSelectionForUser(ORG, USER, ['social-page-selection'])
    ).resolves.toMatchObject({ credentialId: CRED })
  })
})

/**
 * A superseded pending credential must stop mattering — by deletion, or at minimum by losing its
 * marker.
 *
 * The failure this pins was silent and permanent. Disconnect is a SOFT delete, and a connect that
 * died part-way through provisioning leaves a tombstoned Integration still pointing at its
 * credential. The reference check had no `deletedAt` filter, so it read that tombstone as "a live
 * channel depends on this" and skipped the row — leaving the marker in place. From then on
 * `pendingConnectSelection` resumed the picker on every page load, for a credential whose token had
 * already been swapped away, and no later connect ever cleared it.
 */
describe('deleteSupersededPendingCredentials', () => {
  const args = {
    organizationId: ORG,
    userId: USER,
    providerKey: 'facebook',
    keepCredentialId: CRED,
  }
  const staleRow = {
    id: 'cred_stale',
    metadata: { pendingSelection: { ...marker, createdAt: 'x' } },
  }

  it('asks only about LIVE Integrations — a tombstone must not pin the credential', async () => {
    selectRows = [staleRow]

    await deleteSupersededPendingCredentials(args)

    // Asserted on the rendered predicate, not on the outcome: with the mock answering `undefined`
    // either way, a check that had dropped the `deletedAt` filter would still delete the row here
    // and pass an outcome-only test. The filter IS the fix.
    const where = (integrationFindFirst.mock.calls[0]?.[0] as { where: unknown }).where
    const { sql } = dialect.sqlToQuery(where as never)
    expect(sql).toContain('"Integration"."deletedAt" is null')
    expect(deleteCredential).toHaveBeenCalledWith('cred_stale', ORG)
  })

  it('clears the marker instead of deleting when a LIVE Integration references it', async () => {
    selectRows = [staleRow]
    integrationFindFirst.mockResolvedValue({ id: 'int_live' })

    await deleteSupersededPendingCredentials(args)

    // The credential survives — something live depends on it.
    expect(deleteCredential).not.toHaveBeenCalled()
    // ...but the marker must not, or the picker resumes forever on a connect nobody can finish.
    const { sql } = renderLastSet()
    expect(sql).toContain('-')
    expect(captured.sets.length).toBe(1)
  })

  it('never touches the credential being connected right now', async () => {
    selectRows = [{ id: CRED, metadata: { pendingSelection: { ...marker, createdAt: 'x' } } }]

    await deleteSupersededPendingCredentials(args)

    expect(deleteCredential).not.toHaveBeenCalled()
    expect(captured.sets).toEqual([])
  })
})
