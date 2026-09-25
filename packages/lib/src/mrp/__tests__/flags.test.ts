// packages/lib/src/mrp/__tests__/flags.test.ts

import { describe, expect, it } from 'vitest'
import {
  computeFlags,
  type FlagInput,
  hasMirrorDrift,
  isUnbuiltSeller,
  unbuiltSalesPartIds,
} from '../run/flags'
import { classifySupply, resolveStatedLeadTime } from '../run/lead-time'
import type { OpenPoLineInput } from '../types'

const CLEAN: FlagInput = {
  asOf: '2026-09-24',
  supplyType: 'bought',
  leadTimeSource: 'vendor',
  bufferMode: null,
  reliefGapLines: 0,
  unbuiltSales: false,
  leadTimeDrift: false,
  mirrorDrift: false,
  wontMakeNextArrival: false,
  poLines: [],
}

function line(partial: Partial<OpenPoLineInput>): OpenPoLineInput {
  return {
    id: 'l',
    purchaseOrderId: 'po',
    partId: 'p',
    vendorPartId: 'vp',
    supplierId: 's',
    status: 'issued',
    quantityOpen: 10,
    orderedAt: '2026-09-01',
    expectedAt: '2026-10-01',
    ...partial,
  }
}

describe('04 §6: bad data surfaces instead of hiding', () => {
  it('part_cost_source none with BOM children still plans as made, no flag', () => {
    const { supplyType } = classifySupply({
      costSource: 'none',
      hasVendorPart: false,
      hasBomChildren: true,
    })
    expect(supplyType).toBe('made')
    expect(computeFlags({ ...CLEAN, supplyType })).toEqual([])
  })

  it('no part_build_lead_time_days → no_lead_time', () => {
    const { source } = resolveStatedLeadTime({ buildLeadTimeDays: null }, 'made', null)
    expect(computeFlags({ ...CLEAN, supplyType: 'made', leadTimeSource: source })).toEqual([
      'no_lead_time',
    ])
  })

  it('a component whose preferred vendor part has no lead time → no_lead_time', () => {
    const { source } = resolveStatedLeadTime({ buildLeadTimeDays: null }, 'bought', {
      leadTimeDays: null,
    })
    expect(computeFlags({ ...CLEAN, leadTimeSource: source })).toEqual(['no_lead_time'])
  })

  it('sold 40, built 10 → unbuilt_sales on the finished good and its parts', () => {
    expect(isUnbuiltSeller({ sold: 40, produced: 10, opening: 0 })).toBe(true)
    const flagged = unbuiltSalesPartIds(
      ['lift'],
      [
        { parentPartId: 'lift', childPartId: 'assy', quantity: 1 },
        { parentPartId: 'assy', childPartId: 'bracket', quantity: 2 },
      ]
    )
    expect([...flagged].sort()).toEqual(['assy', 'bracket', 'lift'])
    expect(computeFlags({ ...CLEAN, unbuiltSales: flagged.has('bracket') })).toEqual([
      'unbuilt_sales',
    ])
  })

  it('a bought part set to not_buffered → not_buffered_bought', () => {
    expect(computeFlags({ ...CLEAN, bufferMode: 'not_buffered' })).toEqual(['not_buffered_bought'])
    expect(computeFlags({ ...CLEAN, supplyType: 'made', bufferMode: 'not_buffered' })).toEqual([])
  })

  it('a draft PO sitting unissued → draft_po_pending', () => {
    expect(computeFlags({ ...CLEAN, poLines: [line({ status: 'draft' })] })).toEqual([
      'draft_po_pending',
    ])
  })
})

describe('the remaining flags', () => {
  it('relief_gaps when relief skipped lines for the part (01 §3 P1)', () => {
    expect(computeFlags({ ...CLEAN, reliefGapLines: 2 })).toEqual(['relief_gaps'])
  })

  it('lead_time_drift, mirror_drift and wont_make_next_arrival pass through', () => {
    expect(
      computeFlags({ ...CLEAN, leadTimeDrift: true, mirrorDrift: true, wontMakeNextArrival: true })
    ).toEqual(['lead_time_drift', 'mirror_drift', 'wont_make_next_arrival'])
  })

  it('overdue_receipt for an issued open line past its expected date only', () => {
    expect(computeFlags({ ...CLEAN, poLines: [line({ expectedAt: '2026-09-20' })] })).toEqual([
      'overdue_receipt',
    ])
    expect(
      computeFlags({ ...CLEAN, poLines: [line({ expectedAt: '2026-09-20', status: 'draft' })] })
    ).toEqual(['draft_po_pending'])
    expect(computeFlags({ ...CLEAN, poLines: [line({})] })).toEqual([])
  })

  it('unclassified with no lead time', () => {
    expect(computeFlags({ ...CLEAN, supplyType: 'unclassified', leadTimeSource: 'none' })).toEqual([
      'no_lead_time',
      'unclassified',
    ])
  })
})

describe('helpers', () => {
  it('does not flag a seller covered by builds or opening stock', () => {
    expect(isUnbuiltSeller({ sold: 40, produced: 30, opening: 10 })).toBe(false)
    expect(isUnbuiltSeller({ sold: 0, produced: 0, opening: 0 })).toBe(false)
  })

  it('compares the mirror close to part_quantity_on_hand', () => {
    expect(hasMirrorDrift(10, 10)).toBe(false)
    expect(hasMirrorDrift(9, 10)).toBe(true)
    expect(hasMirrorDrift(null, 10)).toBe(false)
  })
})
