// packages/lib/src/data-migrations/migrations/__tests__/182-vendor-bill-amount-discounted.test.ts
//
// One INSERT-only field, so what can go wrong is small: the field must still be
// in the REGISTRY (74 declared it and shipped no migration, which is the whole
// defect), an org short of the def is a skip rather than a throw, the caches
// that serve a field are dropped when one is created, and a re-run creates
// nothing.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = ['vendor_bill']

/** System attributes the org already carries - `ensureCustomFields` is INSERT-only. */
let existingAttributes: Set<string> = new Set()

const ensureCalls: string[][] = []

vi.mock('../../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadExistingState: async () => ({
    entityDefs: new Map(
      existingDefs.map((type) => [type, { id: `def_${type}`, entityType: type }])
    ),
    fields: new Map(),
  }),
  ensureCustomFields: async (
    _db: unknown,
    _organizationId: string,
    _entityType: string,
    _defId: string,
    fields: Record<string, { systemAttribute?: string }>,
    _existing: unknown,
    state: { fieldsCreated: number }
  ) => {
    const attributes = Object.values(fields).map((f) => f.systemAttribute ?? '')
    ensureCalls.push(attributes)
    for (const attribute of attributes) {
      if (existingAttributes.has(attribute)) continue
      existingAttributes.add(attribute)
      state.fieldsCreated++
    }
    return new Map()
  },
}))

const { migration182VendorBillAmountDiscounted } = await import(
  '../182-vendor-bill-amount-discounted'
)
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')
const { VENDOR_BILL_FIELDS } = await import(
  '../../../resources/registry/resources/vendor-bill-fields'
)

const MIGRATION_ID = '182-vendor-bill-amount-discounted'
const ORG = 'org_1'
const DB = {} as Database

const runUp = () => migration182VendorBillAmountDiscounted.up(DB, ORG)

beforeEach(() => {
  existingDefs = ['vendor_bill']
  existingAttributes = new Set()
  ensureCalls.length = 0
  invalidateAndRecompute.mockClear()
})

describe('migration 182 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration182VendorBillAmountDiscounted.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 182, and sorts after 181', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.map((id) => id.split('-')[0]).filter((n) => n === '182')).toHaveLength(1)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(
      ids.indexOf('181-rewalk-provisioned-chart-packs')
    )
  })
})

describe('the field is in the registry (74 D3)', () => {
  it('resolves on the vendor bill under the attribute every reader asks for', () => {
    expect(VENDOR_BILL_FIELDS.amountDiscounted?.systemAttribute).toBe(
      'vendor_bill_amount_discounted'
    )
  })
})

describe('migration 182 up()', () => {
  it('creates the field once and drops the caches that serve it', async () => {
    const result = await runUp()

    expect(ensureCalls).toEqual([['vendor_bill_amount_discounted']])
    expect(result.fieldsCreated).toBe(1)
    expect(result.alreadyUpToDate).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('is idempotent: a re-run creates nothing and drops no cache', async () => {
    await runUp()
    invalidateAndRecompute.mockClear()

    const again = await runUp()

    expect(again.fieldsCreated).toBe(0)
    expect(again.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('is a no-op for an org short of the vendor_bill def', async () => {
    existingDefs = []

    const result = await runUp()

    expect(result.alreadyUpToDate).toBe(true)
    expect(ensureCalls).toEqual([])
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })
})
