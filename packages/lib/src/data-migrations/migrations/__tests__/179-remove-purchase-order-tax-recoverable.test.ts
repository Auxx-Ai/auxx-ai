// packages/lib/src/data-migrations/migrations/__tests__/179-remove-purchase-order-tax-recoverable.test.ts
//
// One delete, so what can go wrong is small and specific:
//
//  - the field must be gone from the REGISTRY, or a fresh org keeps seeding
//    the flag 74-D8 deletes;
//  - `purchase_order_allocation_basis` must NOT go with it - the basis is read
//    by `allocateLandedCost` and stays;
//  - an org short of the def is a SKIP, never a throw;
//  - a re-run finds nothing left to remove.

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import type { Migration179Result } from '../179-remove-purchase-order-tax-recoverable'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = ['purchase_order']

vi.mock('../../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadExistingState: async () => ({
    entityDefs: new Map(
      existingDefs.map((type) => [type, { id: `def_${type}`, entityType: type }])
    ),
    fields: new Map(),
  }),
}))

const { migration179RemovePurchaseOrderTaxRecoverable } = await import(
  '../179-remove-purchase-order-tax-recoverable'
)
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')
const { PURCHASE_ORDER_FIELDS } = await import(
  '../../../resources/registry/resources/purchase-order-fields'
)

const MIGRATION_ID = '179-remove-purchase-order-tax-recoverable'
const ORG = 'org_1'

/** `PerOrgMigration.up` narrows the return type to the shared interface; this restores the richer one for assertions. */
const runUp = (db: Database) =>
  migration179RemovePurchaseOrderTaxRecoverable.up(
    db,
    ORG
  ) as unknown as Promise<Migration179Result>

function resetStubs() {
  existingDefs = ['purchase_order']
  invalidateAndRecompute.mockClear()
}

/** A database whose one `delete()` answers with the ids `.returning()` should report. */
function fakeDb(found: readonly string[]): Database {
  return {
    delete: () => ({
      where: () => ({ returning: async () => found.map((id) => ({ id })) }),
    }),
  } as unknown as Database
}

describe('migration 179 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration179RemovePurchaseOrderTaxRecoverable.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 179', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '179')).toHaveLength(1)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('reaches the shared registry without an entry of its own, sorted after 178', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(
      ids.indexOf('178-vendor-credit-line-returns-stock')
    )
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('the flag is gone from the registry (74-D8)', () => {
  it('no longer resolves on the purchase order', () => {
    expect(PURCHASE_ORDER_FIELDS.taxRecoverable).toBeUndefined()
    const attributes = Object.values(PURCHASE_ORDER_FIELDS).map((f) => f.systemAttribute)
    expect(attributes).not.toContain('purchase_order_tax_recoverable')
  })

  it('leaves the allocation basis, which is still read', () => {
    expect(PURCHASE_ORDER_FIELDS.allocationBasis?.systemAttribute).toBe(
      'purchase_order_allocation_basis'
    )
  })
})

describe('migration 179 up()', () => {
  it('is a no-op for an org short of the purchase_order def', async () => {
    resetStubs()
    existingDefs = []
    const result = await runUp(fakeDb([]))

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.fieldsRemoved).toBe(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('removes the field and drops the caches that serve it', async () => {
    resetStubs()
    const result = await runUp(fakeDb(['f1']))

    expect(result.fieldsRemoved).toBe(1)
    expect(result.alreadyUpToDate).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('is idempotent: a re-run finds nothing left to remove', async () => {
    resetStubs()
    const result = await runUp(fakeDb([]))

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.fieldsRemoved).toBe(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })
})
