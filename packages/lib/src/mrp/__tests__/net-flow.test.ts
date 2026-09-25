// packages/lib/src/mrp/__tests__/net-flow.test.ts

import { describe, expect, it } from 'vitest'
import {
  computePosition,
  computePriority,
  roundOrderQuantity,
  suggestWhenNeeded,
} from '../run/net-flow'
import type { OpenPoLineInput } from '../types'

function line(partial: Partial<OpenPoLineInput>): OpenPoLineInput {
  return {
    id: 'l',
    purchaseOrderId: 'po',
    partId: 'bracket',
    vendorPartId: 'vp',
    supplierId: 'local',
    status: 'issued',
    quantityOpen: 60,
    orderedAt: '2026-09-23',
    expectedAt: '2026-09-30',
    ...partial,
  }
}

/** 04 §3: bracket kit zones 30 / 110 / 160, pack of 20. */
const BRACKET = {
  buffered: true,
  supplyType: 'bought' as const,
  topOfYellow: 110,
  topOfGreen: 160,
  minOrderQty: null,
  purchaseRatio: 20,
}

describe('the bracket kit (04 §3)', () => {
  it('Mon: net flow 118 is above yellow, nothing to order', () => {
    expect(suggestWhenNeeded({ ...BRACKET, netFlow: 118 })).toBeNull()
  })

  it('Tue night: 108 ≤ 110 → order 60 (160 − 108 = 52 → pack of 20)', () => {
    expect(suggestWhenNeeded({ ...BRACKET, netFlow: 108 })).toEqual({
      kind: 'purchase',
      rawQuantity: 52,
      quantity: 60,
      purchaseUnits: 3,
    })
  })

  it('Wed: a draft PO does not count, so net flow stays 108', () => {
    const position = computePosition({
      onHand: 108,
      poLines: [line({ status: 'draft' })],
      builds: [],
      openDemand: 0,
    })
    expect(position.netFlow).toBe(108)
    expect(suggestWhenNeeded({ ...BRACKET, netFlow: position.netFlow })?.quantity).toBe(60)
  })

  it('Wed: once issued, net flow is 168 and it drops off', () => {
    const position = computePosition({
      onHand: 108,
      poLines: [line({})],
      builds: [],
      openDemand: 0,
    })
    expect(position).toEqual({ onHand: 108, onOrder: 60, openDemand: 0, netFlow: 168 })
    expect(suggestWhenNeeded({ ...BRACKET, netFlow: position.netFlow })).toBeNull()
  })
})

describe('computePosition', () => {
  it('adds open builds and subtracts open demand', () => {
    const position = computePosition({
      onHand: 10,
      poLines: [],
      builds: [{ id: 'b', partId: 'p', quantityOpen: 5, dueDay: null }],
      openDemand: 3,
    })
    expect(position.netFlow).toBe(12)
  })
})

describe('roundOrderQuantity (D14)', () => {
  it('raises to MOQ, then whole purchase units', () => {
    expect(roundOrderQuantity(12, 50, 12)).toEqual({ quantity: 60, purchaseUnits: 5 })
    expect(roundOrderQuantity(52, null, null)).toEqual({ quantity: 52, purchaseUnits: 52 })
  })

  it('keeps a need of zero or less at zero', () => {
    expect(roundOrderQuantity(-5, 50, 10)).toEqual({ quantity: 0, purchaseUnits: 0 })
  })
})

describe('suggestWhenNeeded', () => {
  it('suggests a build, unrounded, for a made part', () => {
    expect(suggestWhenNeeded({ ...BRACKET, supplyType: 'made', netFlow: 100 })).toEqual({
      kind: 'build',
      rawQuantity: 60,
      quantity: 60,
      purchaseUnits: 60,
    })
  })

  it('suggests nothing for an unbuffered or unclassified part', () => {
    expect(suggestWhenNeeded({ ...BRACKET, buffered: false, netFlow: 0 })).toBeNull()
    expect(suggestWhenNeeded({ ...BRACKET, supplyType: 'unclassified', netFlow: 0 })).toBeNull()
  })
})

describe('computePriority (D13)', () => {
  it('is net flow ÷ top of green when buffered', () => {
    expect(
      computePriority({
        buffered: true,
        netFlow: 108,
        topOfGreen: 160,
        orderByDate: null,
        asOf: '2026-09-24',
      })
    ).toBeCloseTo(0.675)
  })

  it('is days until order-by otherwise, negative when past', () => {
    const base = { buffered: false, netFlow: 0, topOfGreen: null, asOf: '2026-09-24' }
    expect(computePriority({ ...base, orderByDate: '2026-10-11' })).toBe(17)
    expect(computePriority({ ...base, orderByDate: '2026-09-04' })).toBe(-20)
    expect(computePriority({ ...base, orderByDate: null })).toBeNull()
  })
})
