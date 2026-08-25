// packages/lib/src/import/resolution/__tests__/resolve-relation-lookups.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseType } from '../../../resources/types'

// Mock the cache barrel WHOLESALE (partial-mocking it via importOriginal walks
// its real import graph before the mock exists).
vi.mock('../../../cache', () => ({
  getCachedResource: vi.fn(),
}))

const { getCachedResource } = await import('../../../cache')
const { resolveRelationLookups, updateResolutionsWithLookupResults } = await import(
  '../resolve-relation-lookups'
)

const getCachedResourceMock = vi.mocked(getCachedResource)

const companyResource = {
  type: 'custom',
  id: 'company',
  entityDefinitionId: 'def-company',
  organizationId: 'org-1',
  fields: [
    { key: 'website', id: 'field-web-1', type: BaseType.URL },
    { key: 'email', id: 'field-email-1', type: BaseType.EMAIL },
  ],
  display: { primaryDisplayField: { name: 'name' } },
} as never

const userSystemResource = {
  type: 'system',
  id: 'user',
  dbName: 'User',
  fields: [{ key: 'email', dbColumn: 'email', type: BaseType.EMAIL }],
  display: { primaryDisplayField: { id: 'email' } },
} as never

/** Fake db: FieldValue-lane select chain is thenable and resolves `rows`. */
function buildFakeDb(rows: Array<Record<string, unknown>>) {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.where = () => chain
  // biome-ignore lint/suspicious/noThenProperty: deliberately thenable — the query builder is awaited directly
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve)
  const execute = vi.fn(async () => ({ rows: [] }))
  const db = {
    select: () => chain,
    execute,
    query: { EntityInstance: { findMany: vi.fn(async () => []) } },
  }
  return { db: db as never, execute }
}

function lookup(searchValue: string, matchField: string, hash = `h-${searchValue}`) {
  return {
    hash,
    jobPropertyId: 'jp-1',
    entityDefinitionId: 'company',
    matchField,
    searchValue,
  }
}

beforeEach(() => {
  getCachedResourceMock.mockReset()
  getCachedResourceMock.mockResolvedValue(companyResource)
})

describe('resolveRelationLookups', () => {
  it('matches a URL relation cell against the write-normalized stored value', async () => {
    // Stored: write-path shape. CSV cell: bare mixed-case host — lowercase-only
    // normalization could never match this.
    const { db } = buildFakeDb([
      { entityId: 'rec-1', valueText: 'https://acme.com', valueNumber: null, optionId: null },
    ])
    const results = await resolveRelationLookups(db, 'org-1', [lookup('ACME.com', 'website')])
    expect(results).toHaveLength(1)
    expect(results[0]!.recordId).toBe('def-company:rec-1')
    expect(results[0]!.error).toBeUndefined()
  })

  it('errors on ambiguity instead of last-write-wins', async () => {
    const { db } = buildFakeDb([
      { entityId: 'rec-1', valueText: 'shared@x.com', valueNumber: null, optionId: null },
      { entityId: 'rec-2', valueText: 'shared@x.com', valueNumber: null, optionId: null },
    ])
    const results = await resolveRelationLookups(db, 'org-1', [lookup('shared@x.com', 'email')])
    expect(results[0]!.recordId).toBeNull()
    expect(results[0]!.error).toContain('Ambiguous match')
  })

  it('still resolves a unique match normally', async () => {
    const { db } = buildFakeDb([
      { entityId: 'rec-1', valueText: 'solo@x.com', valueNumber: null, optionId: null },
    ])
    const results = await resolveRelationLookups(db, 'org-1', [lookup('Solo@X.com', 'email')])
    expect(results[0]!.recordId).toBe('def-company:rec-1')
  })

  it('reports no-match for unmatched values', async () => {
    const { db } = buildFakeDb([])
    const results = await resolveRelationLookups(db, 'org-1', [lookup('ghost@x.com', 'email')])
    expect(results[0]!.recordId).toBeNull()
    expect(results[0]!.error).toContain('No match found')
  })

  it('rejects an unknown/unsafe matchField on system resources without touching sql.raw', async () => {
    getCachedResourceMock.mockResolvedValue(userSystemResource)
    const { db, execute } = buildFakeDb([])
    const results = await resolveRelationLookups(db, 'org-1', [
      lookup('x@y.com', '"email" OR 1=1 --'),
    ])
    expect(execute).not.toHaveBeenCalled()
    expect(results[0]!.recordId).toBeNull()
  })

  it('allows a registered system-resource matchField through the gate', async () => {
    getCachedResourceMock.mockResolvedValue(userSystemResource)
    const { db, execute } = buildFakeDb([])
    await resolveRelationLookups(db, 'org-1', [lookup('x@y.com', 'email')])
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('updateResolutionsWithLookupResults, chunking', () => {
  /** N matched results for one column, the shape the resolver emits. */
  const matched = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      hash: `h-${i}`,
      jobPropertyId: 'jp-1',
      recordId: `rec-${i}`,
      outcome: 'matched' as const,
    }))

  it('issues ONE statement per 500 values instead of one per value', async () => {
    const { db, execute } = buildFakeDb([])
    await updateResolutionsWithLookupResults(db, matched(1201))
    // 1201 values used to mean 1201 sequential UPDATEs.
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('issues a single statement for a chunk-sized batch', async () => {
    const { db, execute } = buildFakeDb([])
    await updateResolutionsWithLookupResults(db, matched(500))
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('touches the database at all only when there is something to write', async () => {
    const { db, execute } = buildFakeDb([])
    await updateResolutionsWithLookupResults(db, [])
    expect(execute).not.toHaveBeenCalled()
  })
})
