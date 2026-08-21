// packages/lib/src/import/resolution/__tests__/relation-lookup-policy.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseType } from '../../../resources/types'

// Mock the cache barrel WHOLESALE (partial-mocking it via importOriginal walks
// its real import graph before the mock exists), same shape as the sibling
// resolve-relation-lookups test.
vi.mock('../../../cache', () => ({
  getCachedResource: vi.fn(),
}))

const { getCachedResource } = await import('../../../cache')
const { resolveRelationLookups, RELATION_MATCHABLE_BASE_TYPES } = await import(
  '../resolve-relation-lookups'
)

const getCachedResourceMock = vi.mocked(getCachedResource)

/**
 * The Defect E fixture. `company`'s primary display field is labelled
 * **`Company Name`** while its key is **`name`** a whole word apart, so a
 * "just compare case-insensitively" fix fails every assertion below.
 */
const companyResource = {
  type: 'custom',
  id: 'company',
  label: 'Company',
  entityDefinitionId: 'def-company',
  organizationId: 'org-1',
  fields: [
    { id: 'cf-name', key: 'name', type: BaseType.STRING },
    { id: 'cf-vat', key: 'vat_number', type: BaseType.STRING },
  ],
  display: { primaryDisplayField: { id: 'cf-name', name: 'Company Name', type: 'TEXT' } },
} as never

/** Fake db: the FieldValue select chain is thenable and resolves `rows`. */
function buildFakeDb(rows: Array<Record<string, unknown>>) {
  const chain: Record<string, unknown> = {}
  const select = vi.fn(() => chain)
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.where = () => chain
  // biome-ignore lint/suspicious/noThenProperty: deliberately thenable, the query builder is awaited directly
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve)
  const db = {
    select,
    execute: vi.fn(async () => ({ rows: [] })),
    query: { EntityInstance: { findMany: vi.fn(async () => []) } },
  }
  return { db: db as never, select }
}

function lookup(
  searchValue: string,
  overrides: Partial<{
    matchField: string
    onNoMatch: 'create' | 'blank' | 'fail'
    hash: string
  }> = {}
) {
  return {
    hash: overrides.hash ?? `h-${searchValue}`,
    jobPropertyId: 'jp-1',
    entityDefinitionId: 'company',
    // '' is what `getPendingRelationLookups` produces for a marker with no
    // match field, i.e. exactly what auto-map writes.
    matchField: overrides.matchField ?? '',
    searchValue,
    onNoMatch: overrides.onNoMatch,
  }
}

/** Every lookup in these tests is authorised; authority itself is tested below. */
const allow = { canImportTarget: () => true }

beforeEach(() => {
  getCachedResourceMock.mockReset()
  getCachedResourceMock.mockResolvedValue(companyResource)
})

describe('Defect E, an auto-mapped relation column resolves', () => {
  it('matches through the display field KEY when the column carries no matchField', async () => {
    const { db } = buildFakeDb([
      { entityId: 'rec-1', valueText: 'acme motors', valueNumber: null, optionId: null },
    ])

    const results = await resolveRelationLookups(db, 'org-1', [lookup('Acme Motors')], allow)

    // Before the fix the resolver looked for a field keyed `Company Name`,
    // found none, and returned [], "No match found" for every value, and a
    // failed row wherever the relation is required.
    expect(results[0]!.recordId).toBe('rec-1')
    expect(results[0]!.error).toBeUndefined()
    expect(results[0]!.outcome).toBe('matched')
  })

  it('never looks the display field up by its human label', async () => {
    // A decoy: the resource's ONLY field is keyed by the human label, and the
    // display config points at an id no field carries. A label-trusting
    // resolver finds the decoy and queries FieldValue against it; the fixed one
    // resolves nothing, falls back to `id`, and takes the EntityInstance lane.
    const { db, select } = buildFakeDb([])
    getCachedResourceMock.mockResolvedValue({
      ...(companyResource as unknown as Record<string, unknown>),
      fields: [{ id: 'cf-decoy', key: 'Company Name', type: BaseType.STRING }],
      display: { primaryDisplayField: { id: 'cf-missing', name: 'Company Name', type: 'TEXT' } },
    } as never)

    await resolveRelationLookups(db, 'org-1', [lookup('Ghost Ltd')], allow)

    expect(select).not.toHaveBeenCalled()
    expect(
      (db as unknown as { query: { EntityInstance: { findMany: ReturnType<typeof vi.fn> } } }).query
        .EntityInstance.findMany
    ).toHaveBeenCalledTimes(1)
  })
})

describe('onNoMatch policy', () => {
  it("'fail' reports a row error, the behaviour before the policy existed", async () => {
    const { db } = buildFakeDb([])
    const results = await resolveRelationLookups(
      db,
      'org-1',
      [lookup('Ghost Ltd', { onNoMatch: 'fail' })],
      allow
    )
    expect(results[0]!.outcome).toBe('error')
    expect(results[0]!.error).toContain('No match found')
  })

  it("defaults to 'fail' when the marker carries no policy at all", async () => {
    const { db } = buildFakeDb([])
    const results = await resolveRelationLookups(db, 'org-1', [lookup('Ghost Ltd')], allow)
    expect(results[0]!.outcome).toBe('error')
  })

  it("'blank' imports the row with no link and is NOT an error", async () => {
    const { db } = buildFakeDb([])
    const results = await resolveRelationLookups(
      db,
      'org-1',
      [lookup('Ghost Ltd', { onNoMatch: 'blank' })],
      allow
    )
    expect(results[0]!.outcome).toBe('blank')
    expect(results[0]!.recordId).toBeNull()
    expect(results[0]!.error).toBeUndefined()
  })

  it("'create' defers a mint carrying the RAW cell on the display field", async () => {
    const { db } = buildFakeDb([])
    const results = await resolveRelationLookups(
      db,
      'org-1',
      [lookup('Acme Motors', { onNoMatch: 'create' })],
      allow
    )
    expect(results[0]!.outcome).toBe('create')
    expect(results[0]!.recordId).toBeNull()
    expect(results[0]!.create).toEqual({
      entityDefinitionId: 'def-company',
      matchField: 'name',
      // The raw cell, not the lowercased search key.
      value: 'Acme Motors',
    })
  })

  it("refuses 'create' when the match field is not the target's display field", async () => {
    const { db } = buildFakeDb([])
    const results = await resolveRelationLookups(
      db,
      'org-1',
      [lookup('DE123456789', { matchField: 'vat_number', onNoMatch: 'create' })],
      allow
    )
    expect(results[0]!.outcome).toBe('error')
    expect(results[0]!.error).toContain('display field')
  })

  it('refuses create when the actor may not import into the TARGET definition', async () => {
    const { db } = buildFakeDb([])
    const results = await resolveRelationLookups(
      db,
      'org-1',
      [lookup('Acme Motors', { onNoMatch: 'create' })],
      { canImportTarget: () => false }
    )
    expect(results[0]!.outcome).toBe('error')
    expect(results[0]!.error).toContain("don't have permission")
  })

  it('fails CLOSED when no authority probe is reachable at all', async () => {
    const { db } = buildFakeDb([])
    const results = await resolveRelationLookups(db, 'org-1', [
      lookup('Acme Motors', { onNoMatch: 'create' }),
    ])
    expect(results[0]!.outcome).toBe('error')
  })

  it('asks the target authority ONCE per column, not per value', async () => {
    const { db } = buildFakeDb([])
    const canImportTarget = vi.fn(() => true)
    await resolveRelationLookups(
      db,
      'org-1',
      [
        lookup('A Ltd', { onNoMatch: 'create', hash: 'h-a' }),
        lookup('B Ltd', { onNoMatch: 'create', hash: 'h-b' }),
        lookup('C Ltd', { onNoMatch: 'create', hash: 'h-c' }),
      ],
      { canImportTarget }
    )
    expect(canImportTarget).toHaveBeenCalledTimes(1)
  })
})

describe('multiple matches are ALWAYS a row error', () => {
  const ambiguous = [
    { entityId: 'rec-1', valueText: 'acme motors', valueNumber: null, optionId: null },
    { entityId: 'rec-2', valueText: 'acme motors', valueNumber: null, optionId: null },
  ]

  it.each(['create', 'blank', 'fail'] as const)('errors under onNoMatch=%s', async (policy) => {
    const { db } = buildFakeDb(ambiguous)
    const results = await resolveRelationLookups(
      db,
      'org-1',
      [lookup('Acme Motors', { onNoMatch: policy })],
      allow
    )
    // Guessing which `Acme` was meant is the one wrong link nobody can detect
    // afterwards, so no policy may turn this safety off.
    expect(results[0]!.outcome).toBe('error')
    expect(results[0]!.recordId).toBeNull()
    expect(results[0]!.error).toContain('Ambiguous match')
    expect(results[0]!.error).toContain('2 records')
  })
})

describe('§1.2 relation matching stays case-INSENSITIVE, in both directions', () => {
  it('a lowercase cell links to a stored mixed-case value', async () => {
    const { db } = buildFakeDb([
      { entityId: 'rec-1', valueText: 'm400l', valueNumber: null, optionId: null },
    ])
    const results = await resolveRelationLookups(
      db,
      'org-1',
      [lookup('m400l', { matchField: 'name' })],
      allow
    )
    expect(results[0]!.recordId).toBe('rec-1')
  })

  it('an uppercase cell links to a stored lowercase value', async () => {
    const { db } = buildFakeDb([
      { entityId: 'rec-1', valueText: 'm400l', valueNumber: null, optionId: null },
    ])
    const results = await resolveRelationLookups(
      db,
      'org-1',
      [lookup('M400L', { matchField: 'name' })],
      allow
    )
    // Contract D-F moves the IDENTIFIER path to case-insensitive to agree with
    // this one; the relation direction is pinned here so it can never drift.
    expect(results[0]!.recordId).toBe('rec-1')
  })
})

describe('§5.4 the exported supported-type set equals what the resolver branches on', () => {
  /** Drive the resolver with a field of `type` and report whether it queried. */
  async function resolverQueries(type: BaseType): Promise<boolean> {
    getCachedResourceMock.mockResolvedValue({
      type: 'custom',
      id: 'company',
      label: 'Company',
      entityDefinitionId: 'def-company',
      organizationId: 'org-1',
      fields: [{ id: 'cf-x', key: 'probe', type }],
      display: { primaryDisplayField: { id: 'cf-x', name: 'Probe', type: 'TEXT' } },
    } as never)
    const { db, select } = buildFakeDb([])
    // '42' parses as a number, so the NUMERIC lane is not short-circuited by
    // its own "nothing parsed" guard.
    await resolveRelationLookups(db, 'org-1', [lookup('42', { matchField: 'probe' })], allow)
    return select.mock.calls.length > 0
  }

  it('is an exact set, adding a branch or a filterable type cannot reopen the gap', async () => {
    const queried = new Set<BaseType>()
    for (const type of Object.values(BaseType)) {
      if (await resolverQueries(type)) queried.add(type)
    }
    expect([...queried].sort()).toEqual([...RELATION_MATCHABLE_BASE_TYPES].sort())
  })

  it('excludes the types the picker offers today and can never match', () => {
    // `part.createdAt`/`updatedAt` are DATETIME and `filterable`, `isPreferred`
    // is BOOLEAN, all offerable as match fields, all silently unmatchable.
    expect(RELATION_MATCHABLE_BASE_TYPES.has(BaseType.DATETIME)).toBe(false)
    expect(RELATION_MATCHABLE_BASE_TYPES.has(BaseType.DATE)).toBe(false)
    expect(RELATION_MATCHABLE_BASE_TYPES.has(BaseType.BOOLEAN)).toBe(false)
  })
})
