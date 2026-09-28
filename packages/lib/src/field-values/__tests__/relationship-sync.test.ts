// packages/lib/src/field-values/__tests__/relationship-sync.test.ts

import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { syncInverseRelationships } from '../relationship-sync'

function fakeDb() {
  const deletes: { sql: string; params: unknown[] }[] = []
  const db = {
    delete: vi.fn(() => ({
      where: async (condition: SQL) => {
        deletes.push(new PgDialect().sqlToQuery(condition))
      },
    })),
  }
  return { db, deletes }
}

describe('syncInverseRelationships', () => {
  it('removes the source from each unlinked target’s inverse field', async () => {
    const { db, deletes } = fakeDb()
    await syncInverseRelationships(
      { db, organizationId: 'org-1' } as never,
      {
        entityId: 'payout-1',
        oldRelatedIds: ['rail-1', 'rail-2'],
        newRelatedIds: ['rail-2'],
        inverseInfo: { inverseFieldId: 'inverse-field' },
      } as never
    )

    expect(deletes).toHaveLength(1)
    // entityId IN (the unlinked target), relatedEntityId = the source
    expect(deletes[0]!.params).toEqual(['rail-1', 'inverse-field', 'payout-1', 'org-1'])
  })
})
