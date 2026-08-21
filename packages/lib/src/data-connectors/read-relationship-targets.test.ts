// packages/lib/src/data-connectors/read-relationship-targets.test.ts
// `readRelationshipTargets` (service.ts) — the relationship two-pass's idempotency
// input (v10 relationship-pass-idempotency, Phase 1).
//
// The contract under test is its ASYMMETRY: absence from the returned map always
// means "the caller must write". Only a cell holding exactly one row with a non-null
// target is reported as already-correct — a 2+ row cell is a genuine collapse target
// that `set` would legitimately reduce, so reporting it would silently drop a real
// write. The db is a chain stub; only the grouping logic is exercised.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readRelationshipTargets } from './service'

const ORG = 'org_1'

type Row = { entityId: string; fieldId: string; relatedEntityId: string | null }

/**
 * Chain stub for `db.select({...}).from(...).where(...)` — `where` is the thenable.
 * `stats` is returned by reference so a case can read the query count AFTER awaiting.
 */
function makeDb(rows: Row[]): { db: Database; stats: { whereCalls: number } } {
  const stats = { whereCalls: 0 }
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => {
      stats.whereCalls++
      return Promise.resolve(rows)
    },
  }
  return { db: { select: () => chain } as unknown as Database, stats }
}

const row = (entityId: string, fieldId: string, relatedEntityId: string | null): Row => ({
  entityId,
  fieldId,
  relatedEntityId,
})

describe('readRelationshipTargets', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns no map and issues no query for an empty pair list', async () => {
    const { db, stats } = makeDb([])
    const out = await readRelationshipTargets(db, ORG, [])
    expect(out.size).toBe(0)
    expect(stats.whereCalls).toBe(0)
  })

  it('reports a cell holding exactly one row with a non-null target', async () => {
    const { db } = makeDb([row('e1', 'f1', 't1')])
    const out = await readRelationshipTargets(db, ORG, [{ entityInstanceId: 'e1', fieldId: 'f1' }])
    expect(out.get('e1::f1')).toBe('t1')
  })

  it('OMITS a cell holding two rows — a collapse is a real change', async () => {
    const { db } = makeDb([row('e1', 'f1', 't1'), row('e1', 'f1', 't2')])
    const out = await readRelationshipTargets(db, ORG, [{ entityInstanceId: 'e1', fieldId: 'f1' }])
    expect(out.has('e1::f1')).toBe(false)
  })

  it('OMITS a cell whose single row has a null target', async () => {
    const { db } = makeDb([row('e1', 'f1', null)])
    const out = await readRelationshipTargets(db, ORG, [{ entityInstanceId: 'e1', fieldId: 'f1' }])
    expect(out.has('e1::f1')).toBe(false)
  })

  it('OMITS a cell with no rows at all', async () => {
    const { db } = makeDb([])
    const out = await readRelationshipTargets(db, ORG, [{ entityInstanceId: 'e1', fieldId: 'f1' }])
    expect(out.has('e1::f1')).toBe(false)
  })

  it('discards rows outside the requested pairs — the query is a cross-product superset', async () => {
    // Asking for (e1,f1) and (e2,f2) filters on {e1,e2} × {f1,f2}, so (e1,f2) and
    // (e2,f1) come back from the db and must not leak into the map.
    const { db } = makeDb([
      row('e1', 'f1', 't1'),
      row('e1', 'f2', 'tX'),
      row('e2', 'f1', 'tY'),
      row('e2', 'f2', 't2'),
    ])
    const out = await readRelationshipTargets(db, ORG, [
      { entityInstanceId: 'e1', fieldId: 'f1' },
      { entityInstanceId: 'e2', fieldId: 'f2' },
    ])
    expect([...out.entries()].sort()).toEqual([
      ['e1::f1', 't1'],
      ['e2::f2', 't2'],
    ])
  })

  it('keeps distinct cells independent — one multi-row cell does not poison another', async () => {
    const { db } = makeDb([row('e1', 'f1', 't1'), row('e1', 'f1', 't2'), row('e2', 'f1', 't3')])
    const out = await readRelationshipTargets(db, ORG, [
      { entityInstanceId: 'e1', fieldId: 'f1' },
      { entityInstanceId: 'e2', fieldId: 'f1' },
    ])
    expect(out.has('e1::f1')).toBe(false)
    expect(out.get('e2::f1')).toBe('t3')
  })

  it('deduplicates the id lists so one field across N entities is a single query', async () => {
    const { db, stats } = makeDb([])
    await readRelationshipTargets(db, ORG, [
      { entityInstanceId: 'e1', fieldId: 'f1' },
      { entityInstanceId: 'e2', fieldId: 'f1' },
      { entityInstanceId: 'e3', fieldId: 'f1' },
    ])
    expect(stats.whereCalls).toBe(1)
  })
})
