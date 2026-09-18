// packages/lib/src/data-migrations/migrations/168-remove-gl-posting-stamp-fields.test.ts
//
// Six independent deletes, one per (entityType, systemAttribute) pair, so
// what actually goes wrong is per-stamp, not shared:
//
//  - the six fields must be gone from the REGISTRY, or a fresh org keeps
//    seeding what step 1b retires;
//  - `journal_entry_gl_posting_id` must NOT be one of the six - it is the
//    pointer a journal entry needs to find its own posting, and TARGET §1
//    keeps it;
//  - an org short of a def is a SKIP on that stamp alone, never a throw - a
//    fresh install never seeds these fields at all;
//  - a re-run finds nothing left to remove on an org that already took this
//    migration once.

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import type { Migration168Result } from './168-remove-gl-posting-stamp-fields'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = [
  'fulfillment',
  'credit_memo',
  'payout',
  'bank_deposit',
  'bank_transaction',
  'order',
]

vi.mock('../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadExistingState: async () => ({
    entityDefs: new Map(
      existingDefs.map((type) => [type, { id: `def_${type}`, entityType: type }])
    ),
    fields: new Map(),
  }),
}))

const { migration168RemoveGlPostingStampFields } = await import(
  './168-remove-gl-posting-stamp-fields'
)
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../registry')
const { FULFILLMENT_FIELDS } = await import('../../resources/registry/resources/fulfillment-fields')
const { CREDIT_MEMO_FIELDS } = await import('../../resources/registry/resources/credit-memo-fields')
const { PAYOUT_FIELDS } = await import('../../resources/registry/resources/payout-fields')
const { BANK_DEPOSIT_FIELDS } = await import(
  '../../resources/registry/resources/bank-deposit-fields'
)
const { BANK_TRANSACTION_FIELDS } = await import(
  '../../resources/registry/resources/bank-transaction-fields'
)
const { ORDER_FIELDS } = await import('../../resources/registry/resources/order-fields')
const { JOURNAL_ENTRY_FIELDS } = await import(
  '../../resources/registry/resources/journal-entry-fields'
)

const MIGRATION_ID = '168-remove-gl-posting-stamp-fields'
const ORG = 'org_1'

/** `PerOrgMigration.up` narrows the return type to the shared interface; this restores the richer one for assertions. */
const runUp = (db: Database) =>
  migration168RemoveGlPostingStampFields.up(db, ORG) as unknown as Promise<Migration168Result>

/** Every field key each registry used to carry for the removed stamp. */
const RETIRED_REGISTRY_KEYS: readonly [Record<string, unknown>, string][] = [
  [FULFILLMENT_FIELDS, 'glPosting'],
  [CREDIT_MEMO_FIELDS, 'glPosting'],
  [PAYOUT_FIELDS, 'glPostingId'],
  [BANK_DEPOSIT_FIELDS, 'glPostingId'],
  [BANK_TRANSACTION_FIELDS, 'glPostingId'],
  [ORDER_FIELDS, 'paymentGlPosting'],
]

function resetStubs() {
  existingDefs = [
    'fulfillment',
    'credit_memo',
    'payout',
    'bank_deposit',
    'bank_transaction',
    'order',
  ]
  invalidateAndRecompute.mockClear()
}

/**
 * A database that answers each successive `delete()` with the ids
 * `.returning()` should report, in the SAME order the migration iterates
 * `REMOVED_STAMPS` - fulfillment, credit_memo, payout, bank_deposit,
 * bank_transaction, order.
 */
function fakeDb(foundInOrder: readonly string[][]): Database {
  let callIndex = 0
  return {
    delete: () => ({
      where: () => ({
        returning: async () => (foundInOrder[callIndex++] ?? []).map((id) => ({ id })),
      }),
    }),
  } as unknown as Database
}

describe('migration 168 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration168RemoveGlPostingStampFields.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 168', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '168')).toHaveLength(1)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('reaches the shared registry without an entry of its own, sorted after 167', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('167-document-attachments'))
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('the six stamps are gone from the registry (step 1b)', () => {
  it.each(
    RETIRED_REGISTRY_KEYS.map(([fields, key]) => [fields, key] as const)
  )('%#: no longer resolves', (fields, key) => {
    expect(fields[key]).toBeUndefined()
  })
})

describe('journal_entry_gl_posting_id is not one of the six', () => {
  it('stays on the registry as the pointer the record needs', () => {
    expect(JOURNAL_ENTRY_FIELDS.glPostingId?.systemAttribute).toBe('journal_entry_gl_posting_id')
  })
})

describe('migration 168 up()', () => {
  it('is a no-op for an org short of every def', async () => {
    resetStubs()
    existingDefs = []
    const db = fakeDb([])

    const result = await runUp(db)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.stampsRemoved).toBe(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('removes all six stamps when every def has one', async () => {
    resetStubs()
    const db = fakeDb([['f1'], ['f2'], ['f3'], ['f4'], ['f5'], ['f6']])

    const result = await runUp(db)

    expect(result.stampsRemoved).toBe(6)
    expect(result.alreadyUpToDate).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('removes only the stamps present, skipping a def with none', async () => {
    resetStubs()
    // fulfillment and payout carry a row; the other four defs exist but have
    // already lost theirs (or never had one).
    const db = fakeDb([['f1'], [], ['f3'], [], [], []])

    const result = await runUp(db)

    expect(result.stampsRemoved).toBe(2)
    expect(result.alreadyUpToDate).toBe(false)
  })

  it('skips a stamp whose def the org never seeded, without throwing', async () => {
    resetStubs()
    existingDefs = ['fulfillment']
    const db = fakeDb([['f1']])

    const result = await runUp(db)

    expect(result.stampsRemoved).toBe(1)
  })

  it('is idempotent: a re-run finds nothing left to remove', async () => {
    resetStubs()
    const db = fakeDb([[], [], [], [], [], []])

    const result = await runUp(db)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.stampsRemoved).toBe(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })
})
