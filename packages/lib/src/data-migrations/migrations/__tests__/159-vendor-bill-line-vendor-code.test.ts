// packages/lib/src/data-migrations/migrations/__tests__/159-vendor-bill-line-vendor-code.test.ts
//
// Migration 159 is one INSERT over a def that already exists, so the write is
// not what silently goes wrong. What does:
//
//  - the id is a permanent ledger key in a space shared with the whole-database
//    shape, and a reused one is skipped by every database that ran the old
//    migration, with no error;
//  - the migration names its one field by KEY, so a registry rename with no
//    rename here provisions nothing while claiming one field. The migration
//    throws on that, and this pins the key so the throw is never the first
//    anyone hears of it;
//  - the field must be TEXT and nullable, because it is the printed code on a
//    document nobody has re-read yet, never a required value;
//  - a sort order colliding with an existing vendor_bill_line field would
//    reorder the panel rather than slot in after `description`.

import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it, vi } from 'vitest'
import type { ResourceField } from '../../../resources/registry/field-types'

// `getOrgCache` is a Redis round trip nothing here backs, and
// `entity-helpers` is the database. Both stubbed for the same reason 151's
// and 156's tests stub them: `up()` is being driven for its DECISIONS.
const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = ['vendor_bill_line']
/** Field keys the stubbed `ensureCustomFields` reports as already present. */
let existingFieldKeys: string[] = []
/** Every `ensureCustomFields` call this run made, for the assertions below. */
const ensureCalls: { entityType: string; defId: string; fieldKeys: string[] }[] = []

// Spread the original: `registry.ts` also imports other per-org migrations,
// which need `ensureEntityDefinitions`, `linkNewRelationships` and
// `linkDisplayFields` to exist as named exports at import time.
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
    entityType: string,
    defId: string,
    fields: Record<string, ResourceField>,
    _existing: unknown,
    state: { fieldsCreated: number }
  ) => {
    const fieldKeys = Object.keys(fields)
    ensureCalls.push({ entityType, defId, fieldKeys })
    for (const key of fieldKeys) {
      if (!existingFieldKeys.includes(key)) state.fieldsCreated++
    }
    return new Map()
  },
}))

const { migration159VendorBillLineVendorCode } = await import('../159-vendor-bill-line-vendor-code')
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')
const { VENDOR_BILL_LINE_FIELDS } = await import(
  '../../../resources/registry/resources/vendor-bill-line-fields'
)

const MIGRATION_ID = '159-vendor-bill-line-vendor-code'
const ORG = 'org_1'
const DB = {} as never

function resetStubs() {
  existingDefs = ['vendor_bill_line']
  existingFieldKeys = []
  ensureCalls.length = 0
  invalidateAndRecompute.mockClear()
}

describe('migration 159 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration159VendorBillLineVendorCode.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 159', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '159')).toHaveLength(1)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('reaches the shared registry without an entry of its own, sorted last', () => {
    // `buildRegistry` spreads `PER_ORG_MIGRATIONS.map(perOrgMigration)`, so
    // registering there is the whole job - a hand-written entry would be a
    // duplicate id that `assertUniqueMigrationIds` throws on at module load.
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('what the migration provisions exists in the registry', () => {
  it('vendorCode is a vendor_bill_line field carrying vendor_bill_line_vendor_code', () => {
    const field = VENDOR_BILL_LINE_FIELDS.vendorCode
    expect(field).toBeDefined()
    expect(field?.key).toBe('vendorCode')
    expect(field?.systemAttribute).toBe('vendor_bill_line_vendor_code')
    expect(field?.isSystem).toBe(true)
  })

  it('declares a systemAttribute in the shared union', () => {
    expect(SYSTEM_ATTRIBUTES).toContain(VENDOR_BILL_LINE_FIELDS.vendorCode?.systemAttribute)
  })

  it('is nullable, because it is unknown until a document has been read', () => {
    expect(VENDOR_BILL_LINE_FIELDS.vendorCode?.nullable).toBe(true)
  })

  it('is TEXT, not a relationship or a select', () => {
    expect(VENDOR_BILL_LINE_FIELDS.vendorCode?.fieldType).toBe('TEXT')
    expect(VENDOR_BILL_LINE_FIELDS.vendorCode?.type).toBe('string')
  })

  it('is hidden from the table but shown in the panel', () => {
    expect(VENDOR_BILL_LINE_FIELDS.vendorCode?.showInTable).toBe(false)
    expect(VENDOR_BILL_LINE_FIELDS.vendorCode?.showInPanel).toBe(true)
  })

  it("describes itself as the vendor's printed code, never the part's SKU", () => {
    const description = VENDOR_BILL_LINE_FIELDS.vendorCode?.description ?? ''
    expect(description).toMatch(/vendor/i)
    expect(description).toMatch(/SKU/)
  })
})

describe('the sort order slots in right after description', () => {
  it('gives every vendor_bill_line field a distinct sort order', () => {
    const orders = Object.values(VENDOR_BILL_LINE_FIELDS)
      .map((f) => f.systemSortOrder)
      .filter((s): s is string => typeof s === 'string')
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('sorts after description and before quantityBilled', () => {
    const description = VENDOR_BILL_LINE_FIELDS.description?.systemSortOrder ?? ''
    const vendorCode = VENDOR_BILL_LINE_FIELDS.vendorCode?.systemSortOrder ?? ''
    const quantityBilled = VENDOR_BILL_LINE_FIELDS.quantityBilled?.systemSortOrder ?? ''
    expect(vendorCode > description).toBe(true)
    expect(vendorCode < quantityBilled).toBe(true)
  })
})

describe('migration 159 up()', () => {
  it('skips an org that never got the vendor_bill_line def, touching nothing', async () => {
    resetStubs()
    existingDefs = ['vendor_bill']

    const result = await migration159VendorBillLineVendorCode.up(DB, ORG)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.fieldsCreated).toBe(0)
    expect(ensureCalls).toHaveLength(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('provisions exactly the one field onto the vendor_bill_line def', async () => {
    resetStubs()

    const result = await migration159VendorBillLineVendorCode.up(DB, ORG)

    expect(ensureCalls).toHaveLength(1)
    expect(ensureCalls[0]?.entityType).toBe('vendor_bill_line')
    expect(ensureCalls[0]?.defId).toBe('def_vendor_bill_line')
    expect(ensureCalls[0]?.fieldKeys).toEqual(['vendorCode'])
    expect(result.fieldsCreated).toBe(1)
    expect(result.alreadyUpToDate).toBe(false)
    expect(result.entityDefsCreated).toBe(0)
  })

  it('flushes the field caches, because a stale one drops every write', async () => {
    resetStubs()

    await migration159VendorBillLineVendorCode.up(DB, ORG)

    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('is idempotent: a re-run writes nothing and flushes nothing', async () => {
    resetStubs()
    existingFieldKeys = ['vendorCode']

    const result = await migration159VendorBillLineVendorCode.up(DB, ORG)

    expect(result.fieldsCreated).toBe(0)
    expect(result.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })
})
