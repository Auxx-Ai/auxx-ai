// packages/lib/src/import/fields/__tests__/auto-map-columns.test.ts

import { describe, expect, it } from 'vitest'
import { autoMapColumns, type ColumnHeader } from '../auto-map-columns'
import type { FieldGroup, ImportableField } from '../get-importable-fields'

/**
 * These pin the fallback matcher against the field sets it actually gets, in
 * the ORDER it actually gets them — `getImportableFields` emits the identifier
 * pass, then scalars, then relations, and both defects below were decided by
 * that order rather than by any header.
 *
 * The supplier-price importer is the case that exposed them: every one of its
 * keys carries the `vendor_part_` prefix, so a one-word header matched all of
 * them at once.
 */

function field(
  key: string,
  label: string,
  overrides: Partial<ImportableField> = {}
): ImportableField {
  return {
    key,
    label,
    type: 'text',
    required: false,
    isRelation: false,
    isIdentifier: false,
    group: 'system' as FieldGroup,
    ...overrides,
  }
}

/** Record ID, as the identifier pass emits it: first, and tier 1. */
const RECORD_ID = field('id', 'Record ID', {
  group: 'identifier',
  isIdentifier: true,
  identifierTier: 1,
})

/** `vendor_part`, in `getImportableFields` order. */
const VENDOR_PART_FIELDS: ImportableField[] = [
  RECORD_ID,
  field('vendor_part_vendor_sku', 'Vendor SKU'),
  field('vendor_part_unit_price', 'Unit Price', { type: 'currency' }),
  field('vendor_part_shipping_cost', 'Shipping Cost', { type: 'currency' }),
  field('vendor_part_tariff_rate', 'Tariff Rate (%)', { type: 'number' }),
  field('vendor_part_other_cost', 'Other Cost', { type: 'currency' }),
  field('vendor_part_lead_time', 'Lead Time', { type: 'number' }),
  field('vendor_part_min_order_qty', 'Min Order Qty', { type: 'number' }),
  field('vendor_part_is_preferred', 'Preferred', { type: 'boolean' }),
  field('vendor_part_part', 'Part', { type: 'relation', isRelation: true, required: true }),
  field('vendor_part_contact', 'Supplier', { type: 'relation', isRelation: true, required: true }),
]

/** `subpart` — two relations onto the SAME def, so it cannot lean on the target. */
const SUBPART_FIELDS: ImportableField[] = [
  RECORD_ID,
  field('subpart_quantity', 'Quantity', { type: 'number' }),
  field('subpart_notes', 'Notes'),
  field('subpart_parent_part', 'Parent Part', { type: 'relation', isRelation: true }),
  field('subpart_child_part', 'Child Part', { type: 'relation', isRelation: true }),
]

const CONTACT_FIELDS: ImportableField[] = [
  RECORD_ID,
  field('email', 'Email', { type: 'email', identifierTier: 1 }),
  field('firstName', 'First Name'),
  field('lastName', 'Last Name'),
  field('phone', 'Phone', { type: 'phone' }),
  field('company', 'Company'),
]

const headers = (...names: string[]): ColumnHeader[] =>
  names.map((name, index) => ({ index, name }))

/** `{ header: matched field key }`, with `null` for a column left unmapped. */
function mapped(names: string[], fields: ImportableField[]): Record<string, string | null> {
  const results = autoMapColumns(headers(...names), fields)
  return Object.fromEntries(results.map((r) => [r.columnName, r.matchedField?.key ?? null]))
}

describe('autoMapColumns — the supplier-price file', () => {
  const SUPPLIER_PRICE_HEADERS = [
    'Part',
    'Supplier',
    'Vendor SKU',
    'Unit Price',
    'Min Order Qty',
    'Lead Time',
    'Shipping Cost',
    'Tariff Rate (%)',
    'Preferred',
  ]

  it('maps every column to the field it names', () => {
    expect(mapped(SUPPLIER_PRICE_HEADERS, VENDOR_PART_FIELDS)).toEqual({
      Part: 'vendor_part_part',
      Supplier: 'vendor_part_contact',
      'Vendor SKU': 'vendor_part_vendor_sku',
      'Unit Price': 'vendor_part_unit_price',
      'Min Order Qty': 'vendor_part_min_order_qty',
      'Lead Time': 'vendor_part_lead_time',
      'Shipping Cost': 'vendor_part_shipping_cost',
      'Tariff Rate (%)': 'vendor_part_tariff_rate',
      Preferred: 'vendor_part_is_preferred',
    })
  })

  it('does not park any column on Record ID', () => {
    const onRecordId = Object.entries(mapped(SUPPLIER_PRICE_HEADERS, VENDOR_PART_FIELDS))
      .filter(([, key]) => key === 'id')
      .map(([header]) => header)

    // `Vendor SKU` used to land here: `normalizeForComparison('id')` was `''`,
    // and every string contains the empty string, so Record ID scored 0.7
    // against every header. Being tier 1 it then became the import's match key,
    // and `text:cuid` rejected all 13 vendor SKUs as "Invalid ID format".
    expect(onRecordId).toEqual([])
  })

  it('does not let a required relation lose its column to a name that merely contains it', () => {
    // Every `vendor_part_*` key contains the word `part`, so `Part` tied at 1.0
    // with all of them and the winner fell out of field order — scalars first.
    const result = mapped(['Part'], VENDOR_PART_FIELDS)
    expect(result.Part).toBe('vendor_part_part')
  })
})

describe('autoMapColumns — Record ID is claimed, never defaulted to', () => {
  it('still matches a header that names it', () => {
    expect(mapped(['Record ID'], VENDOR_PART_FIELDS)).toEqual({ 'Record ID': 'id' })
    expect(mapped(['id'], VENDOR_PART_FIELDS)).toEqual({ id: 'id' })
  })

  it('leaves a column that matches nothing unmapped', () => {
    expect(mapped(['Warehouse Bin', 'Notes From Buyer'], VENDOR_PART_FIELDS)).toEqual({
      'Warehouse Bin': null,
      'Notes From Buyer': null,
    })
  })
})

describe('autoMapColumns — resources that already worked keep working', () => {
  it('maps a BOM file onto both legs of the subpart key', () => {
    expect(mapped(['Parent Part', 'Child Part', 'Quantity', 'Notes'], SUBPART_FIELDS)).toEqual({
      'Parent Part': 'subpart_parent_part',
      'Child Part': 'subpart_child_part',
      Quantity: 'subpart_quantity',
      Notes: 'subpart_notes',
    })
  })

  it('maps an ordinary contact file, abbreviations and all', () => {
    expect(mapped(['Email', 'First', 'Last Name', 'Mobile', 'Company'], CONTACT_FIELDS)).toEqual({
      Email: 'email',
      First: 'firstName',
      'Last Name': 'lastName',
      Mobile: 'phone',
      Company: 'company',
    })
  })
})
