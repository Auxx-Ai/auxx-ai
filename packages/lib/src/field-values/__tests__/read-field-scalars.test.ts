// packages/lib/src/field-values/__tests__/read-field-scalars.test.ts
//
// The set-based read behind every parent-level recompute. Its three callers each
// replaced an `await` in a loop, so what matters here is the query SHAPE — the
// chunk bound, and the absent-vs-null distinction every caller branches on.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: vi.fn(), where: vi.fn() }))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  return {
    schema,
    database: {
      select: () => ({
        from: () => ({
          where: (predicate: unknown) => {
            h.where(predicate)
            return h.rows()
          },
        }),
      }),
    },
  }
})

import { readFieldRelations, readFieldScalars } from '../read-field-scalars'

const ORG = 'org_1'

beforeEach(() => {
  vi.clearAllMocks()
  h.rows.mockResolvedValue([])
})

describe('readFieldScalars', () => {
  it('reads many records in ONE query', async () => {
    h.rows.mockResolvedValue([
      { entityId: 'a', fieldId: 'f1', valueNumber: 10 },
      { entityId: 'b', fieldId: 'f1', valueNumber: 20 },
    ])

    const out = await readFieldScalars(undefined, ORG, ['a', 'b'], ['f1'])

    expect(h.rows).toHaveBeenCalledTimes(1)
    expect(out.get('a')?.get('f1')).toBe(10)
    expect(out.get('b')?.get('f1')).toBe(20)
  })

  it('chunks past 200 ids rather than sending one unbounded IN-list', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `r-${i}`)
    await readFieldScalars(undefined, ORG, ids, ['f1'])
    expect(h.rows).toHaveBeenCalledTimes(2)
  })

  it('dedupes ids so a repeated parent does not widen the query', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `r-${i % 100}`)
    await readFieldScalars(undefined, ORG, ids, ['f1'])
    expect(h.rows).toHaveBeenCalledTimes(1)
  })

  it('leaves a record with no rows ABSENT, not present-and-empty', async () => {
    h.rows.mockResolvedValue([{ entityId: 'a', fieldId: 'f1', valueNumber: 1 }])

    const out = await readFieldScalars(undefined, ORG, ['a', 'b'], ['f1'])

    expect(out.has('a')).toBe(true)
    // Callers branch on this: an absent `taxable` defaults to taxable, a stored
    // `false` does not, and collapsing the two flips a total.
    expect(out.has('b')).toBe(false)
  })

  it('keeps a stored false, which is not the same as no row', async () => {
    h.rows.mockResolvedValue([{ entityId: 'a', fieldId: 'f1', valueBoolean: false }])
    const out = await readFieldScalars(undefined, ORG, ['a'], ['f1'])
    expect(out.get('a')?.get('f1')).toBe(false)
  })

  it('keeps a stored zero', async () => {
    h.rows.mockResolvedValue([{ entityId: 'a', fieldId: 'f1', valueNumber: 0 }])
    const out = await readFieldScalars(undefined, ORG, ['a'], ['f1'])
    expect(out.get('a')?.get('f1')).toBe(0)
  })

  it('issues no query at all for an empty id or field set', async () => {
    expect((await readFieldScalars(undefined, ORG, [], ['f1'])).size).toBe(0)
    expect((await readFieldScalars(undefined, ORG, ['a'], [])).size).toBe(0)
    expect(h.rows).not.toHaveBeenCalled()
  })
})

describe('readFieldRelations', () => {
  it('returns the related instance id, keyed by record and field', async () => {
    h.rows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-quote', relatedEntityId: 'q-1' },
      { entityId: 'li-2', fieldId: 'f-quote', relatedEntityId: 'q-1' },
    ])

    const out = await readFieldRelations(undefined, ORG, ['li-1', 'li-2'], ['f-quote'])

    expect(h.rows).toHaveBeenCalledTimes(1)
    expect(out.get('li-1')?.get('f-quote')).toBe('q-1')
    expect(out.get('li-2')?.get('f-quote')).toBe('q-1')
  })

  it('drops a row whose relation is empty rather than storing null', async () => {
    h.rows.mockResolvedValue([{ entityId: 'li-1', fieldId: 'f-quote', relatedEntityId: null }])
    const out = await readFieldRelations(undefined, ORG, ['li-1'], ['f-quote'])
    expect(out.has('li-1')).toBe(false)
  })

  it('separates two relation fields on one record — the parent ladder depends on it', async () => {
    h.rows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-invoice', relatedEntityId: 'inv-1' },
      { entityId: 'li-1', fieldId: 'f-wo', relatedEntityId: 'wo-1' },
    ])

    const out = await readFieldRelations(undefined, ORG, ['li-1'], ['f-invoice', 'f-wo'])

    expect(out.get('li-1')?.get('f-invoice')).toBe('inv-1')
    expect(out.get('li-1')?.get('f-wo')).toBe('wo-1')
  })

  it('uses the given connection when one is passed', async () => {
    const rows = vi.fn().mockResolvedValue([])
    const tx = { select: () => ({ from: () => ({ where: rows }) }) }

    await readFieldRelations(tx as never, ORG, ['li-1'], ['f-quote'])

    expect(rows).toHaveBeenCalledTimes(1)
    expect(h.rows).not.toHaveBeenCalled()
  })
})
