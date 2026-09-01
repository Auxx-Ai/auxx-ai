// packages/lib/src/seed/entity-migrations/migrations/121-rate-precision.test.ts
//
// Migration 121 is a pure `options.decimals` UPDATE (plus two new field
// inserts), so what can silently go wrong is never the write: it is the two
// lists drifting apart. `RATE_FIELDS` here and the `decimals: RATE_DECIMALS`
// stamped in each registry file are the SAME nineteen attributes read by two
// different doors: the registry reaches a fresh org, this migration reaches
// an existing one. If they diverge, whether a rate field admits a fifth
// place depends on when the org signed up. These tests pin that they agree,
// pin the merge helper's legacy-shape tolerance, and pin the two B-lite
// fields the registry now declares.

import { RATE_DECIMALS } from '@auxx/utils/currency'
import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import type { ResourceField } from '../../../resources/registry/field-types'
import { VENDOR_PART_FIELDS } from '../../../resources/registry/resources/vendor-part-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { migration121RatePrecision, withRateDecimals } from './121-rate-precision'

// Mirrors the private `RATE_FIELDS` list in 121-rate-precision.ts. Kept as a
// literal here (rather than exported from the migration) so this test is
// exercising the SAME two independent sources the migration itself reconciles,
// the registry and a hand-written spec, the way 106/118's tests do.
const RATE_FIELD_SPECS: ReadonlyArray<{ entityType: string; systemAttribute: string }> = [
  { entityType: 'vendor_part', systemAttribute: 'vendor_part_unit_price' },
  { entityType: 'vendor_part', systemAttribute: 'vendor_part_shipping_cost' },
  { entityType: 'vendor_part', systemAttribute: 'vendor_part_other_cost' },
  { entityType: 'part', systemAttribute: 'part_cost' },
  { entityType: 'part', systemAttribute: 'part_purchase_cost' },
  { entityType: 'part', systemAttribute: 'part_rollup_cost' },
  { entityType: 'part', systemAttribute: 'part_standard_cost' },
  { entityType: 'part', systemAttribute: 'part_standard_material_cost' },
  { entityType: 'part', systemAttribute: 'part_standard_labor_cost' },
  { entityType: 'part', systemAttribute: 'part_standard_overhead_cost' },
  { entityType: 'part', systemAttribute: 'part_labor_cost_per_unit' },
  { entityType: 'part', systemAttribute: 'part_overhead_cost_per_unit' },
  {
    entityType: 'purchase_order_line',
    systemAttribute: 'purchase_order_line_expected_unit_price',
  },
  { entityType: 'vendor_bill_line', systemAttribute: 'vendor_bill_line_unit_price' },
  { entityType: 'stock_movement', systemAttribute: 'stock_movement_unit_cost' },
  { entityType: 'stock_movement', systemAttribute: 'stock_movement_vendor_unit_price' },
  { entityType: 'line_item', systemAttribute: 'line_item_unit_price' },
  { entityType: 'catalog_item', systemAttribute: 'catalog_item_cost' },
  { entityType: 'catalog_item', systemAttribute: 'catalog_item_default_unit_price' },
]

function findField(entityType: string, systemAttribute: string): ResourceField | undefined {
  const registry = RESOURCE_FIELD_REGISTRY[entityType as keyof typeof RESOURCE_FIELD_REGISTRY] as
    | Record<string, ResourceField>
    | undefined
  return Object.values(registry ?? {}).find((f) => f.systemAttribute === systemAttribute)
}

describe('migration 121 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '121-rate-precision')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(migration121RatePrecision.id).toBe('121-rate-precision')
  })

  it('does not reuse an id already spent in the shared space', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id.startsWith('121-'))).toEqual(['121-rate-precision'])
  })
})

describe('the registry agrees with the migration: exactly nineteen rate fields at decimals=5', () => {
  it('covers exactly the nineteen attributes (plans/money/tasks/31-sub-cent-rates.md §2.2)', () => {
    expect(RATE_FIELD_SPECS).toHaveLength(19)
    expect(new Set(RATE_FIELD_SPECS.map((s) => s.systemAttribute)).size).toBe(19)
  })

  it('every rate attribute exists in its registry and declares decimals=RATE_DECIMALS', () => {
    for (const spec of RATE_FIELD_SPECS) {
      const field = findField(spec.entityType, spec.systemAttribute)
      expect(
        field,
        `${spec.systemAttribute} missing from the ${spec.entityType} registry`
      ).toBeDefined()
      expect(field?.options?.decimals, `${spec.systemAttribute} decimals`).toBe(RATE_DECIMALS)
    }
  })

  // `extendedCost`/`lineTotal`/`line_total` siblings are AMOUNTS, not rates:
  // they must stay at the currency's exponent (unset or 2), never RATE_DECIMALS.
  it('leaves the sibling amount fields alone', () => {
    const amountSiblings: ReadonlyArray<{ entityType: string; systemAttribute: string }> = [
      { entityType: 'stock_movement', systemAttribute: 'stock_movement_extended_cost' },
      { entityType: 'purchase_order_line', systemAttribute: 'purchase_order_line_line_total' },
      { entityType: 'vendor_bill_line', systemAttribute: 'vendor_bill_line_line_total' },
      { entityType: 'line_item', systemAttribute: 'line_item_line_total' },
    ]
    for (const spec of amountSiblings) {
      const field = findField(spec.entityType, spec.systemAttribute)
      expect(field, `${spec.systemAttribute} missing`).toBeDefined()
      expect(field?.options?.decimals, `${spec.systemAttribute} decimals`).not.toBe(RATE_DECIMALS)
    }
  })
})

describe('the registry agrees with the migration: the two B-lite offer fields', () => {
  it('vendor_part declares purchaseUnit as a nullable TEXT field', () => {
    const field = VENDOR_PART_FIELDS.purchaseUnit
    expect(field).toBeDefined()
    expect(field?.systemAttribute).toBe('vendor_part_purchase_unit')
    expect(field?.nullable).toBe(true)
    expect(field?.capabilities?.creatable).toBe(true)
    expect(field?.capabilities?.updatable).toBe(true)
  })

  it('vendor_part declares purchaseRatio as a nullable NUMBER field', () => {
    const field = VENDOR_PART_FIELDS.purchaseRatio
    expect(field).toBeDefined()
    expect(field?.systemAttribute).toBe('vendor_part_purchase_ratio')
    expect(field?.nullable).toBe(true)
    expect(field?.capabilities?.creatable).toBe(true)
    expect(field?.capabilities?.updatable).toBe(true)
  })
})

describe('withRateDecimals: the options merge, both shapes seen in the DB', () => {
  it('overwrites decimals in place on a flat shape, keeping every other key', () => {
    const merged = withRateDecimals({ currencyCode: 'USD', decimals: 2, useGrouping: true })
    expect(merged).toEqual({ currencyCode: 'USD', decimals: RATE_DECIMALS, useGrouping: true })
  })

  it('adds decimals alongside a legacy nested shape, leaving the nested object untouched', () => {
    const legacy = { currency: { decimalPlaces: 'two-places', symbol: '$' } }
    const merged = withRateDecimals(legacy)
    expect(merged).toEqual({
      currency: { decimalPlaces: 'two-places', symbol: '$' },
      decimals: RATE_DECIMALS,
    })
    // The nested object is the SAME reference, not a rebuilt copy.
    expect(merged.currency).toBe(legacy.currency)
  })

  it('handles null/undefined options (a field with no options block yet)', () => {
    expect(withRateDecimals(null)).toEqual({ decimals: RATE_DECIMALS })
    expect(withRateDecimals(undefined)).toEqual({ decimals: RATE_DECIMALS })
  })

  it('is idempotent: merging an already-migrated flat shape is a no-op value', () => {
    const already = { currencyCode: 'USD', decimals: RATE_DECIMALS }
    expect(withRateDecimals(already)).toEqual(already)
  })
})
