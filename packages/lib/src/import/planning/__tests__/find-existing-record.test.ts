// packages/lib/src/import/planning/__tests__/find-existing-record.test.ts
//
// Unit coverage for the ROUTING decisions: which lane a tuple takes, what the
// lookup core is asked for, and how its answers map onto the result union.
// The SQL predicates themselves are pinned against a real database in
// `find-existing-record.int.test.ts`, a fake db cannot see a WHERE clause.

import { describe, expect, it, vi } from 'vitest'

class FakeAmbiguousLookupError extends Error {
  constructor(readonly matchCount: number) {
    super(`Matches ${matchCount} existing records`)
  }
}

const lookupEntitiesByFieldValue = vi.fn()

// Mock the lookup module rather than the cache barrel: it keeps the org cache
// out of the import graph entirely, and `AmbiguousLookupError` has to be the
// SAME class object the code under test compares against.
vi.mock('../../../resources/lookup/lookup-entities-by-field-value', () => ({
  lookupEntitiesByFieldValue: (...args: unknown[]) => lookupEntitiesByFieldValue(...args),
  AmbiguousLookupError: FakeAmbiguousLookupError,
}))

const { createFindExistingRecord } = await import('../find-existing-record')

import type { Resource, ResourceField } from '../../../resources'
import { BaseType } from '../../../workflow-engine/core/types'

const PART_RESOURCE = {
  id: 'part',
  type: 'custom',
  entityDefinitionId: 'def-part',
} as unknown as Resource

const SKU_FIELD = {
  id: 'f-sku',
  key: 'part_sku',
  type: BaseType.STRING,
} as unknown as ResourceField

const SUPPLIER_FIELD = {
  id: 'f-supplier',
  key: 'supplier',
  type: BaseType.STRING,
} as unknown as ResourceField

/** `dbColumn: 'id'` is the discriminator, NOT `key`, see the branch comment. */
const RECORD_ID_FIELD = {
  id: 'id',
  key: 'id',
  dbColumn: 'id',
  type: BaseType.STRING,
} as unknown as ResourceField

const ok = (items: Array<{ recordId: string }>) => ({
  isErr: () => false,
  value: { items, hasMore: false },
})
const errWith = (error: Error) => ({ isErr: () => true, error })

/** Fake db capturing the EntityInstance lane used by the `id` branch. */
function instanceDb(rows: Array<{ id: string }>) {
  const state = { selectCalls: 0 }
  const db = {
    select: () => {
      state.selectCalls++
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.where = () => chain
      chain.limit = () => Promise.resolve(rows)
      return chain
    },
  }
  return { db: db as never, state }
}

const find = (identifierFields: ResourceField[], db: never) =>
  createFindExistingRecord({
    db,
    organizationId: 'org-1',
    resource: PART_RESOURCE,
    identifierFields,
  })

describe('createFindExistingRecord, Record ID on an entity-backed resource', () => {
  // Defect C. `id` can never resolve through the FieldValue lane: the field
  // map is keyed by CustomField.id and the seeder excludes `id`, so
  // `resolveField` missed both lookups and the whole thing returned null while
  // logging "no candidate was usable".
  it('queries EntityInstance directly and never touches the lookup core', async () => {
    const { db, state } = instanceDb([{ id: 'inst-7' }])
    const result = await find([RECORD_ID_FIELD], db)({ id: 'inst-7' })

    expect(result).toEqual({ kind: 'one', recordId: 'inst-7' })
    expect(state.selectCalls).toBe(1)
    expect(lookupEntitiesByFieldValue).not.toHaveBeenCalled()
  })

  it('returns none when the id resolves to nothing', async () => {
    const { db } = instanceDb([])
    await expect(find([RECORD_ID_FIELD], db)({ id: 'nope' })).resolves.toEqual({ kind: 'none' })
  })

  // NOT `parseRecordId`: on a bare cuid it returns an EMPTY instanceId and
  // console.errors, which would turn every ordinary Record-ID cell into a
  // silent no-match.
  it('tolerates a prefixed record id by splitting on the first colon', async () => {
    const { db } = instanceDb([{ id: 'cm9x123' }])
    await expect(find([RECORD_ID_FIELD], db)({ id: 'part:cm9x123' })).resolves.toEqual({
      kind: 'one',
      recordId: 'cm9x123',
    })
  })

  it('treats a blank id cell as no match, without querying', async () => {
    const { db, state } = instanceDb([{ id: 'inst-7' }])
    await expect(find([RECORD_ID_FIELD], db)({ id: '  ' })).resolves.toEqual({ kind: 'none' })
    expect(state.selectCalls).toBe(0)
  })
})

describe('createFindExistingRecord, FieldValue lane', () => {
  it('asks for limit 2, case-insensitive text, and onAmbiguous error', async () => {
    lookupEntitiesByFieldValue.mockResolvedValue(ok([{ recordId: 'def-part:inst-1' }]))
    const result = await find([SKU_FIELD], {} as never)({ part_sku: 'm400l' })

    expect(result).toEqual({ kind: 'one', recordId: 'inst-1' })
    expect(lookupEntitiesByFieldValue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        entityDefinitionId: 'def-part',
        candidates: [{ fieldId: 'f-sku', value: 'm400l' }],
        limit: 2,
        // One identifier field stays on the OR path, AND of one is the same
        // set, and keeping the ordinary case on its original code path is the
        // point.
        matchAll: false,
        excludeArchived: true,
        caseInsensitiveText: true,
        onAmbiguous: 'error',
      })
    )
  })

  it('maps an ambiguity error onto the result union, carrying the count', async () => {
    lookupEntitiesByFieldValue.mockResolvedValue(errWith(new FakeAmbiguousLookupError(2)))
    await expect(find([SKU_FIELD], {} as never)({ part_sku: 'M400L' })).resolves.toEqual({
      kind: 'ambiguous',
      count: 2,
    })
  })

  // A structural failure is NOT "no match". Swallowing it is the fail-open
  // that turns a transient DB error into a duplicate record.
  it('rethrows a non-ambiguity lookup error instead of reporting no match', async () => {
    lookupEntitiesByFieldValue.mockResolvedValue(errWith(new Error('connection terminated')))
    await expect(find([SKU_FIELD], {} as never)({ part_sku: 'M400L' })).rejects.toThrow(
      'connection terminated'
    )
  })
})

describe('createFindExistingRecord, composite key', () => {
  it('ANDs the candidates via matchAll, in the declared order', async () => {
    lookupEntitiesByFieldValue.mockResolvedValue(ok([{ recordId: 'def-part:vp-1' }]))
    const result = await find(
      [SKU_FIELD, SUPPLIER_FIELD],
      {} as never
    )({
      part_sku: 'M400L',
      supplier: 'ACME',
    })

    expect(result).toEqual({ kind: 'one', recordId: 'vp-1' })
    expect(lookupEntitiesByFieldValue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        matchAll: true,
        candidates: [
          { fieldId: 'f-sku', value: 'M400L' },
          { fieldId: 'f-supplier', value: 'ACME' },
        ],
      })
    )
  })

  // Falling back to the components we DO have would silently widen the key
  // and update the wrong record.
  it('never partially matches when a component is missing', async () => {
    lookupEntitiesByFieldValue.mockClear()
    const result = await find(
      [SKU_FIELD, SUPPLIER_FIELD],
      {} as never
    )({
      part_sku: 'M400L',
      supplier: '',
    })
    expect(result).toEqual({ kind: 'none' })
    expect(lookupEntitiesByFieldValue).not.toHaveBeenCalled()
  })
})
