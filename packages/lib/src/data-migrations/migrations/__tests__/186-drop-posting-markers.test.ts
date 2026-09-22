// packages/lib/src/data-migrations/migrations/__tests__/186-drop-posting-markers.test.ts
//
// The five marker fields `AccountingWorkItem` replaces (91 §4.6): gone from the
// registry so a fresh org never seeds them, dropped per def for an existing org,
// a def the org lacks skipped, and a re-run a no-op.

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import type { Migration186Result } from '../186-drop-posting-markers'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

let existingDefs: string[] = []

vi.mock('../../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadExistingState: async () => ({
    entityDefs: new Map(
      existingDefs.map((type) => [type, { id: `def_${type}`, entityType: type }])
    ),
    fields: new Map(),
  }),
}))

const { migration186DropPostingMarkers } = await import('../186-drop-posting-markers')
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')
const { FULFILLMENT_FIELDS } = await import(
  '../../../resources/registry/resources/fulfillment-fields'
)
const { CREDIT_MEMO_FIELDS } = await import(
  '../../../resources/registry/resources/credit-memo-fields'
)
const { PAYOUT_FIELDS } = await import('../../../resources/registry/resources/payout-fields')

const runUp = (db: Database) =>
  migration186DropPostingMarkers.up(db, 'org_1') as unknown as Promise<Migration186Result>

/** A database whose `delete()` calls answer, in order, with these many removed rows. */
function fakeDb(removed: number[]): { db: Database; deletes: number } {
  const state = { deletes: 0 }
  const db = {
    delete: () => ({
      where: () => ({
        returning: async () =>
          Array.from({ length: removed[state.deletes++] ?? 0 }, (_, i) => ({ id: `f_${i}` })),
      }),
    }),
  } as unknown as Database
  return {
    db,
    get deletes() {
      return state.deletes
    },
  }
}

describe('migration 186', () => {
  it('is registered once, and 184/185 are retired', () => {
    expect(PER_ORG_MIGRATIONS.filter((m) => m.id === '186-drop-posting-markers')).toHaveLength(1)
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers).not.toContain('184')
    expect(numbers).not.toContain('185')
  })

  it('leaves none of the five fields in the registry', () => {
    const attributes = [
      ...Object.values(FULFILLMENT_FIELDS),
      ...Object.values(CREDIT_MEMO_FIELDS),
      ...Object.values(PAYOUT_FIELDS),
    ].map((field) => (field as { systemAttribute?: string }).systemAttribute)
    for (const removed of [
      'fulfillment_posting_blocked_reason',
      'fulfillment_posting_blocked_at',
      'credit_memo_issue_blocked_reason',
      'credit_memo_issue_blocked_at',
      'payout_blocked_reason',
    ])
      expect(attributes).not.toContain(removed)
  })

  it('drops the markers on each def the org holds and busts the caches', async () => {
    existingDefs = ['fulfillment', 'credit_memo', 'payout']
    invalidateAndRecompute.mockClear()
    const fake = fakeDb([2, 2, 1])
    const result = await runUp(fake.db)
    expect(fake.deletes).toBe(3)
    expect(result).toMatchObject({ fieldsRemoved: 5, alreadyUpToDate: false })
    expect(invalidateAndRecompute).toHaveBeenCalledWith('org_1', ['customFields', 'resources'])
  })

  it('skips a def the org lacks and is a no-op on a re-run', async () => {
    existingDefs = ['payout']
    invalidateAndRecompute.mockClear()
    const fake = fakeDb([0])
    const result = await runUp(fake.db)
    expect(fake.deletes).toBe(1)
    expect(result).toMatchObject({ fieldsRemoved: 0, alreadyUpToDate: true })
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })
})
