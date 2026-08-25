// packages/lib/src/field-values/__tests__/inverse-repoint-fallback.test.ts
//
// Unit test for the single-value inverse reconcile's lost-update guard
// (code-review finding on relationship-sync): the per-target re-point UPDATE
// runs with no advisory lock, so under READ COMMITTED a concurrent writer
// can delete the row between the in-tx read and the UPDATE. A 0-row UPDATE
// must fall back to inserting the intended row — the old clear-all+INSERT
// recreated it regardless. The interleave cannot be orchestrated in an int
// test (the window is inside one transaction), so this drives
// `syncInverseRelationships` through a scripted fake db that answers the
// exact statement sequence and reports a 0-row UPDATE.

import { describe, expect, it } from 'vitest'
import { syncInverseRelationships } from '../relationship-sync'

/** Thenable statement-builder stub: every method chains, awaiting resolves `result`. */
function chain(result: unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const m of ['from', 'where', 'orderBy', 'set', 'returning']) {
    c[m] = () => c
  }
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown): Promise<unknown> =>
    Promise.resolve(result).then(resolve, reject)
  return c
}

describe('single-value inverse re-point fallback', () => {
  it('a 0-row UPDATE (row deleted since the in-tx read) falls back to inserting the row', async () => {
    const insertedBatches: unknown[][] = []

    const fakeTx = {
      // In-tx stored read: target T holds an inverse row pointing at OLD.
      select: () =>
        chain([
          {
            id: 'row-1',
            entityId: 'target-T',
            relatedEntityId: 'old-owner',
            relatedEntityDefinitionId: 'def-source',
            sortKey: 'a0',
          },
        ]),
      // Re-point UPDATE returns NO rows — the row vanished after the read.
      update: () => chain([]),
      delete: () => chain([]),
      insert: () => ({
        values: (rows: unknown[]) => {
          insertedBatches.push(rows)
          return Promise.resolve()
        },
      }),
    }

    const fakeDb = {
      // Outside-tx cascade read (existing inverse values): none.
      select: () => chain([]),
      delete: () => chain([]),
      transaction: async (fn: (tx: typeof fakeTx) => Promise<unknown>) => await fn(fakeTx),
    }

    await syncInverseRelationships(
      { db: fakeDb as never, organizationId: 'org-1' },
      {
        entityId: 'source-S',
        oldRelatedIds: [],
        newRelatedIds: ['target-T'],
        inverseInfo: {
          inverseFieldId: 'field-inv',
          inverseRelationshipType: 'belongs_to',
          sourceEntityDefinitionId: 'def-source',
          targetEntityDefinitionId: 'def-target',
          sourceFieldId: 'field-src',
        },
      }
    )

    // The intended assignment survived as an INSERT instead of vanishing.
    expect(insertedBatches).toHaveLength(1)
    expect(insertedBatches[0]).toEqual([
      expect.objectContaining({
        entityId: 'target-T',
        fieldId: 'field-inv',
        relatedEntityId: 'source-S',
        relatedEntityDefinitionId: 'def-source',
        organizationId: 'org-1',
      }),
    ])
  })

  it('a successful re-point (1 row) does not insert', async () => {
    const insertedBatches: unknown[][] = []

    const fakeTx = {
      select: () =>
        chain([
          {
            id: 'row-1',
            entityId: 'target-T',
            relatedEntityId: 'old-owner',
            relatedEntityDefinitionId: 'def-source',
            sortKey: 'a0',
          },
        ]),
      update: () => chain([{ id: 'row-1' }]),
      delete: () => chain([]),
      insert: () => ({
        values: (rows: unknown[]) => {
          insertedBatches.push(rows)
          return Promise.resolve()
        },
      }),
    }

    const fakeDb = {
      select: () => chain([]),
      delete: () => chain([]),
      transaction: async (fn: (tx: typeof fakeTx) => Promise<unknown>) => await fn(fakeTx),
    }

    await syncInverseRelationships(
      { db: fakeDb as never, organizationId: 'org-1' },
      {
        entityId: 'source-S',
        oldRelatedIds: [],
        newRelatedIds: ['target-T'],
        inverseInfo: {
          inverseFieldId: 'field-inv',
          inverseRelationshipType: 'belongs_to',
          sourceEntityDefinitionId: 'def-source',
          targetEntityDefinitionId: 'def-target',
          sourceFieldId: 'field-src',
        },
      }
    )

    expect(insertedBatches).toHaveLength(0)
  })
})
