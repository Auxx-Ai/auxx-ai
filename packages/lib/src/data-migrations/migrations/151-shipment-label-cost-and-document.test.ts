// packages/lib/src/data-migrations/migrations/151-shipment-label-cost-and-document.test.ts
//
// Migration 151 is four INSERTs over a def that already exists, so the write is
// not what silently goes wrong. What does:
//
//  - the id is a permanent ledger key in a space shared with the whole-database
//    shape, and a reused one is skipped by every database that ran the old
//    migration, with no error;
//  - the migration names its four fields by KEY, so a registry rename with no
//    rename here provisions fewer fields than it claims to. The migration
//    throws on that, and this pins the keys so the throw is never the first
//    anyone hears of it;
//  - CURRENCY is an INTEGER MINOR-UNIT amount. The provider sends a decimal, so
//    a field declared as NUMBER, or a key without the `Minor` suffix that says
//    what the integer means, is how $16.54 silently becomes 16 cents;
//  - a sort order colliding with an existing shipment field would reorder the
//    panel rather than append to it.

import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it, vi } from 'vitest'
import type { ResourceField } from '../../resources/registry/field-types'

// `getOrgCache` is a Redis round trip nothing here backs, and
// `entity-helpers` is the database. Both stubbed for the same reason 150's
// test stubs the cache: `up()` is being driven for its DECISIONS.
const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = ['shipment']
/** Field keys the stubbed `ensureCustomFields` reports as already present. */
let existingFieldKeys: string[] = []
/** Every `ensureCustomFields` call this run made, for the assertions below. */
const ensureCalls: { entityType: string; defId: string; fieldKeys: string[] }[] = []

// Spread the original: `registry.ts` also imports 149, which needs
// `ensureEntityDefinitions`, `linkNewRelationships` and `linkDisplayFields` to
// exist as named exports at import time.
vi.mock('../../seed/entity-helpers', async (importOriginal) => ({
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

const { migration151ShipmentLabelCostAndDocument } = await import(
  './151-shipment-label-cost-and-document'
)
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../registry')
const { SHIPMENT_FIELDS } = await import('../../resources/registry/resources/shipment-fields')

const MIGRATION_ID = '151-shipment-label-cost-and-document'
const ORG = 'org_1'
const DB = {} as never

/** The four keys this migration exists to provision, with their attributes. */
const NEW_FIELDS = [
  ['costMinor', 'shipment_cost'],
  ['insuranceCostMinor', 'shipment_insurance_cost'],
  ['insuranceClaim', 'shipment_insurance_claim'],
  ['labelUrl', 'shipment_label_url'],
] as const

function resetStubs() {
  existingDefs = ['shipment']
  existingFieldKeys = []
  ensureCalls.length = 0
  invalidateAndRecompute.mockClear()
}

describe('migration 151 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration151ShipmentLabelCostAndDocument.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 151', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '151')).toHaveLength(1)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('reaches the shared registry without an entry of its own, sorted after 149', () => {
    // `buildRegistry` spreads `PER_ORG_MIGRATIONS.map(perOrgMigration)`, so
    // registering there is the whole job - a hand-written entry would be a
    // duplicate id that `assertUniqueMigrationIds` throws on at module load.
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    // 149 created the def this widens; the registry's own id sort is what
    // guarantees the order.
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('149-shipment-parcel'))
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('what the migration provisions exists in the registry', () => {
  it.each(NEW_FIELDS)('%s is a shipment field carrying %s', (key, attribute) => {
    const field = SHIPMENT_FIELDS[key]
    expect(field).toBeDefined()
    expect(field?.key).toBe(key)
    expect(field?.systemAttribute).toBe(attribute)
    expect(field?.isSystem).toBe(true)
  })

  it.each(NEW_FIELDS)('%s declares a systemAttribute in the shared union', (key) => {
    expect(SYSTEM_ATTRIBUTES).toContain(SHIPMENT_FIELDS[key]?.systemAttribute)
  })

  it.each(NEW_FIELDS)('%s is nullable, because only a live label supplies one', (key) => {
    // Every one is label-level and the shipment can outlive its label: a fully
    // voided shipment has no live label at all, so a value is never guaranteed.
    expect(SHIPMENT_FIELDS[key]?.nullable).toBe(true)
  })
})

describe('the money fields say they are integer minor units', () => {
  // `field-value-helpers.ts`: CURRENCY is NUMBER's shape exactly, an integer
  // minor-unit amount. ShipStation sends `{"currency":"usd","amount":16.54}`
  // and the mapping layer has no transform hook, so the connector multiplies.
  // Declaring these NUMBER, or naming them without `Minor`, is how the decimal
  // gets written through and $16.54 becomes 16 cents.
  const MONEY_KEYS = ['costMinor', 'insuranceCostMinor'] as const

  it.each(MONEY_KEYS)('%s is CURRENCY, not NUMBER', (key) => {
    expect(SHIPMENT_FIELDS[key]?.fieldType).toBe('CURRENCY')
    expect(SHIPMENT_FIELDS[key]?.type).toBe('currency')
  })

  it.each(MONEY_KEYS)('%s keeps the Minor suffix that says what the integer is', (key) => {
    expect(key.endsWith('Minor')).toBe(true)
  })

  it.each(MONEY_KEYS)('%s declares the two-decimal USD denomination, like totalMinor', (key) => {
    // A value never carries its own denomination on the read path: the render
    // site resolves it from these options. All observed data is US domestic.
    expect(SHIPMENT_FIELDS[key]?.options).toMatchObject({
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    })
  })
})

describe('the document and claim fields', () => {
  it('stores the label as a URL rather than a file reference', () => {
    // Owner decision: a plain link, not a fetched `MediaAsset`. The href is
    // unauthenticated, so a link in the UI works with no proxying.
    expect(SHIPMENT_FIELDS.labelUrl?.fieldType).toBe('URL')
    expect(SHIPMENT_FIELDS.labelUrl?.type).toBe('url')
  })

  it('warns in its own description that the label URL is a bearer secret', () => {
    // The one fact about this column that cannot be recovered by reading its
    // type: anyone holding the string fetches a document carrying a customer's
    // name and address, so it must never be exported, logged or handed onward.
    const description = SHIPMENT_FIELDS.labelUrl?.description ?? ''
    expect(description).toMatch(/BEARER SECRET/)
    expect(description).toMatch(/unauthenticated/i)
  })

  it('keeps the insurance claim TEXT, with its unknown shape recorded', () => {
    // Owner decision 2026-09-11, forward-looking: null on all 50 probed labels
    // because nothing on the account is insured, so the wire shape is unknown
    // and the connector must emit only a string.
    expect(SHIPMENT_FIELDS.insuranceClaim?.fieldType).toBe('TEXT')
    expect(SHIPMENT_FIELDS.insuranceClaim?.description ?? '').toMatch(/UNKNOWN|unknown/)
  })
})

describe('the sort orders append rather than reshuffle', () => {
  it('gives every shipment field a distinct sort order', () => {
    const orders = Object.values(SHIPMENT_FIELDS)
      .map((f) => f.systemSortOrder)
      .filter((s): s is string => typeof s === 'string')
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('sorts all four after every field that already existed', () => {
    const newKeys = NEW_FIELDS.map(([key]) => key) as string[]
    const previous = Object.entries(SHIPMENT_FIELDS)
      .filter(([key]) => !newKeys.includes(key))
      // `createdAt` / `updatedAt` / `createdBy` are the trailing common block.
      .filter(([key]) => !['createdAt', 'updatedAt', 'createdBy'].includes(key))
      .map(([, field]) => field.systemSortOrder ?? '')
    const added = newKeys.map((key) => SHIPMENT_FIELDS[key]?.systemSortOrder ?? '')

    for (const order of added) {
      for (const existing of previous) {
        expect(order > existing).toBe(true)
      }
      // ...and still ahead of the common trailing block, so the panel keeps
      // Created / Updated / Created By last.
      expect(order < (SHIPMENT_FIELDS.createdAt?.systemSortOrder ?? 'b0')).toBe(true)
      expect(order < (SHIPMENT_FIELDS.createdBy?.systemSortOrder ?? 'az')).toBe(true)
    }
  })
})

describe('migration 151 up()', () => {
  it('skips an org that never got the shipment def, touching nothing', async () => {
    resetStubs()
    existingDefs = ['order']

    const result = await migration151ShipmentLabelCostAndDocument.up(DB, ORG)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.fieldsCreated).toBe(0)
    expect(ensureCalls).toHaveLength(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('provisions exactly the four fields onto the shipment def', async () => {
    resetStubs()

    const result = await migration151ShipmentLabelCostAndDocument.up(DB, ORG)

    expect(ensureCalls).toHaveLength(1)
    expect(ensureCalls[0]?.entityType).toBe('shipment')
    expect(ensureCalls[0]?.defId).toBe('def_shipment')
    expect(ensureCalls[0]?.fieldKeys).toEqual([
      'costMinor',
      'insuranceCostMinor',
      'insuranceClaim',
      'labelUrl',
    ])
    expect(result.fieldsCreated).toBe(4)
    expect(result.alreadyUpToDate).toBe(false)
    expect(result.entityDefsCreated).toBe(0)
  })

  it('flushes the field caches, because a stale one drops every write', async () => {
    resetStubs()

    await migration151ShipmentLabelCostAndDocument.up(DB, ORG)

    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('is idempotent: a re-run writes nothing and flushes nothing', async () => {
    resetStubs()
    existingFieldKeys = ['costMinor', 'insuranceCostMinor', 'insuranceClaim', 'labelUrl']

    const result = await migration151ShipmentLabelCostAndDocument.up(DB, ORG)

    expect(result.fieldsCreated).toBe(0)
    expect(result.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('is self-sufficient: a partly-applied org gets only what it is missing', async () => {
    // The ledger retries a batch from the top, so an org that took two fields
    // before a later org failed must complete rather than duplicate.
    resetStubs()
    existingFieldKeys = ['costMinor', 'insuranceCostMinor']

    const result = await migration151ShipmentLabelCostAndDocument.up(DB, ORG)

    expect(result.fieldsCreated).toBe(2)
    expect(result.alreadyUpToDate).toBe(false)
  })
})
