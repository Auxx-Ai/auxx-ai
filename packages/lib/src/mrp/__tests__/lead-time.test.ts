// packages/lib/src/mrp/__tests__/lead-time.test.ts

import { describe, expect, it } from 'vitest'
import {
  classifySupply,
  hasLeadTimeDrift,
  observeLine,
  pickPreferredVendorPart,
  resolveStatedLeadTime,
  summarizeSupplyHistory,
} from '../run/lead-time'
import type { ReceiptObservation, VendorPartInput } from '../types'

function vp(partial: Partial<VendorPartInput>): VendorPartInput {
  return {
    id: 'vp',
    partId: 'p',
    supplierId: 's',
    leadTimeDays: 7,
    minOrderQty: null,
    purchaseRatio: null,
    isPreferred: false,
    ...partial,
  }
}

function obs(partial: Partial<ReceiptObservation>): ReceiptObservation {
  return {
    purchaseOrderLineId: 'l',
    partId: 'p',
    vendorPartId: 'vp',
    createdAt: '2026-09-01',
    orderedAt: '2026-09-02',
    expectedAt: '2026-09-09',
    quantityOrdered: 100,
    receipts: [{ day: '2026-09-09', quantity: 100 }],
    ...partial,
  }
}

describe('classifySupply (D12)', () => {
  it('follows part_cost_source', () => {
    expect(
      classifySupply({ costSource: 'vendor', hasVendorPart: false, hasBomChildren: true })
    ).toEqual({
      supplyType: 'bought',
      structural: false,
    })
    expect(
      classifySupply({ costSource: 'bom', hasVendorPart: true, hasBomChildren: false }).supplyType
    ).toBe('made')
  })

  it('falls back to structure on none', () => {
    expect(
      classifySupply({ costSource: 'none', hasVendorPart: true, hasBomChildren: true })
    ).toEqual({
      supplyType: 'bought',
      structural: true,
    })
    expect(
      classifySupply({ costSource: null, hasVendorPart: false, hasBomChildren: true }).supplyType
    ).toBe('made')
    expect(
      classifySupply({ costSource: 'none', hasVendorPart: false, hasBomChildren: false }).supplyType
    ).toBe('unclassified')
  })
})

describe('stated lead time (D11)', () => {
  it('prefers the preferred vendor part, else the shortest lead time', () => {
    const a = vp({ id: 'a', leadTimeDays: 30 })
    const b = vp({ id: 'b', leadTimeDays: 10 })
    expect(pickPreferredVendorPart([a, b])?.id).toBe('b')
    expect(
      pickPreferredVendorPart([
        a,
        { ...b, isPreferred: false },
        { ...a, id: 'c', isPreferred: true },
      ])?.id
    ).toBe('c')
    expect(pickPreferredVendorPart([])).toBeNull()
  })

  it('resolves bought from the vendor part and made from the build lead time', () => {
    expect(
      resolveStatedLeadTime({ buildLeadTimeDays: null }, 'bought', vp({ leadTimeDays: 40 }))
    ).toEqual({
      leadTimeDays: 40,
      source: 'vendor',
    })
    expect(resolveStatedLeadTime({ buildLeadTimeDays: 2 }, 'made', null)).toEqual({
      leadTimeDays: 2,
      source: 'build',
    })
  })

  it('is none without a stated value', () => {
    expect(resolveStatedLeadTime({ buildLeadTimeDays: null }, 'made', null).source).toBe('none')
    expect(
      resolveStatedLeadTime({ buildLeadTimeDays: 2 }, 'bought', vp({ leadTimeDays: null })).source
    ).toBe('none')
    expect(resolveStatedLeadTime({ buildLeadTimeDays: 2 }, 'unclassified', null).source).toBe(
      'none'
    )
  })
})

describe('observeLine (02 §6.2)', () => {
  it('ends the lead time at the receipt reaching 90 %, counting all receipts for fill', () => {
    const result = observeLine(
      obs({
        receipts: [
          { day: '2026-09-04', quantity: 10 },
          { day: '2026-09-12', quantity: 85 },
        ],
      })
    )
    expect(result).toEqual({
      ok: true,
      value: {
        purchaseOrderLineId: 'l',
        leadTimeDays: 10,
        latenessDays: 3,
        fill: 0.95,
        receiptCount: 2,
      },
    })
  })

  it('excludes backfilled paperwork and lines never 90 % received', () => {
    expect(observeLine(obs({ orderedAt: null }))).toEqual({ ok: false, reason: 'no_ordered_at' })
    expect(observeLine(obs({ orderedAt: '2026-09-09' }))).toEqual({
      ok: false,
      reason: 'ordered_on_receipt_day',
    })
    expect(observeLine(obs({ createdAt: '2026-09-10' }))).toEqual({
      ok: false,
      reason: 'created_after_receipt',
    })
    expect(observeLine(obs({ receipts: [{ day: '2026-09-09', quantity: 50 }] }))).toEqual({
      ok: false,
      reason: 'not_received',
    })
  })
})

describe('summarizeSupplyHistory', () => {
  it('computes median, p90, on-time rate and fill over clean lines', () => {
    const stats = summarizeSupplyHistory([
      obs({ purchaseOrderLineId: 'a' }),
      obs({ purchaseOrderLineId: 'b', receipts: [{ day: '2026-09-14', quantity: 100 }] }),
      obs({ purchaseOrderLineId: 'c', receipts: [{ day: '2026-09-12', quantity: 90 }] }),
      obs({ purchaseOrderLineId: 'd', orderedAt: null }),
    ])
    expect(stats.count).toBe(3)
    expect(stats.excluded).toBe(1)
    expect(stats.medianLeadTimeDays).toBe(10)
    expect(stats.p90LeadTimeDays).toBeCloseTo(11.6)
    expect(stats.onTimeRate).toBeCloseTo(1 / 3)
    expect(stats.medianLatenessDays).toBe(3)
    expect(stats.p90LatenessDays).toBeCloseTo(4.6)
    expect(stats.avgFill).toBeCloseTo((1 + 1 + 0.9) / 3)
  })
})

describe('hasLeadTimeDrift (Q10)', () => {
  it('flags stated 7 vs median 12 over 3 receipts (04 §3)', () => {
    expect(hasLeadTimeDrift(7, { count: 3, medianLeadTimeDays: 12 })).toBe(true)
  })

  it('needs 3 clean receipts', () => {
    expect(hasLeadTimeDrift(7, { count: 2, medianLeadTimeDays: 12 })).toBe(false)
  })

  it('ignores gaps within max(3 days, 25 %)', () => {
    expect(hasLeadTimeDrift(7, { count: 5, medianLeadTimeDays: 10 })).toBe(false)
    expect(hasLeadTimeDrift(40, { count: 5, medianLeadTimeDays: 50 })).toBe(false)
    expect(hasLeadTimeDrift(40, { count: 5, medianLeadTimeDays: 51 })).toBe(true)
    expect(hasLeadTimeDrift(null, { count: 5, medianLeadTimeDays: 51 })).toBe(false)
  })
})
