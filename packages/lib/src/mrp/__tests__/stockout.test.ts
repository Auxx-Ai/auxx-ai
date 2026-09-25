// packages/lib/src/mrp/__tests__/stockout.test.ts

import { describe, expect, it } from 'vitest'
import {
  computeStockout,
  findCrossingDay,
  type ProjectionInput,
  poLineLandingDay,
  projectedReceiptsForPart,
  projectOnHandAt,
} from '../run/stockout'
import type { OpenPoLineInput } from '../types'

const MOTOR: ProjectionInput = {
  fromDay: '2026-09-24',
  onHand: 200,
  receipts: [],
  baseAdu: 2,
  seasonalIndex: null,
}

function line(partial: Partial<OpenPoLineInput>): OpenPoLineInput {
  return {
    id: 'l',
    purchaseOrderId: 'po',
    partId: 'p',
    vendorPartId: null,
    supplierId: null,
    status: 'issued',
    quantityOpen: 10,
    orderedAt: null,
    expectedAt: null,
    ...partial,
  }
}

describe('findCrossingDay', () => {
  it('dates the Acme motor cushion Dec 10 (200 → 45 at 2/day, 02 §6.4)', () => {
    expect(findCrossingDay(MOTOR, 45)).toBe('2026-12-10')
  })

  it('returns today when already at or below the threshold', () => {
    expect(findCrossingDay({ ...MOTOR, onHand: 40 }, 45)).toBe('2026-09-24')
  })

  it('pushes the date out by a receipt landing before the crossing', () => {
    // +40 on Oct 1 is 20 more days at 2/day.
    const withPo = { ...MOTOR, receipts: [{ day: '2026-10-01', quantity: 40 }] }
    expect(findCrossingDay(withPo, 45)).toBe('2026-12-30')
  })

  it('returns null with no usage or beyond the horizon', () => {
    expect(findCrossingDay({ ...MOTOR, baseAdu: 0 }, 45)).toBeNull()
    expect(findCrossingDay(MOTOR, 45, 30)).toBeNull()
  })

  it('follows the seasonal rate month by month', () => {
    const index = Array(12).fill(1)
    index[9] = 2 // October doubles
    // Sep 24–30: 7 days × 2 = 14; then 4/day in Oct: 36 left → 9 days → Oct 10 (crossing at 16.0 → day 16).
    const seasonal = { ...MOTOR, onHand: 95, seasonalIndex: index }
    expect(findCrossingDay(seasonal, 45)).toBe('2026-10-10')
  })
})

describe('projectOnHandAt', () => {
  it('counts receipts landing on or before the day and usage before it', () => {
    const withPo = { ...MOTOR, receipts: [{ day: '2026-10-01', quantity: 40 }] }
    expect(projectOnHandAt(withPo, '2026-10-01')).toBe(200 + 40 - 14)
    expect(projectOnHandAt(withPo, '2026-09-30')).toBe(200 - 12)
  })
})

describe('computeStockout', () => {
  it('gives stockout, cushion and order-by for the Acme motor', () => {
    expect(computeStockout(MOTOR, 45, 60)).toEqual({
      stockoutDate: '2027-01-02',
      cushionDate: '2026-12-10',
      orderByDate: '2026-10-11',
    })
  })

  it('uses the stockout date as the cushion date when unbuffered', () => {
    const r = computeStockout(MOTOR, 0, 7)
    expect(r.cushionDate).toBe(r.stockoutDate)
  })

  it('has no order-by without a lead time and no dates without usage', () => {
    expect(computeStockout(MOTOR, 45, null).orderByDate).toBeNull()
    expect(computeStockout({ ...MOTOR, baseAdu: 0 }, 45, 60).stockoutDate).toBeNull()
  })
})

describe('receipts', () => {
  it('lands a line on its expected date, else ordered + lead time, else today', () => {
    expect(poLineLandingDay(line({ expectedAt: '2026-10-05' }), '2026-09-24', 7, null)).toBe(
      '2026-10-05'
    )
    expect(poLineLandingDay(line({ orderedAt: '2026-09-20' }), '2026-09-24', 7, null)).toBe(
      '2026-09-27'
    )
    expect(poLineLandingDay(line({}), '2026-09-24', null, null)).toBe('2026-09-24')
  })

  it('moves an overdue line to today + median lateness', () => {
    expect(poLineLandingDay(line({ expectedAt: '2026-09-01' }), '2026-09-24', 7, 4)).toBe(
      '2026-09-28'
    )
  })

  it('projects issued lines and open builds, never drafts', () => {
    const receipts = projectedReceiptsForPart({
      asOf: '2026-09-24',
      poLines: [
        line({ expectedAt: '2026-10-01' }),
        line({ status: 'draft', expectedAt: '2026-10-01' }),
      ],
      builds: [{ id: 'b', partId: 'p', quantityOpen: 5, dueDay: null }],
      leadTimeDays: 7,
      buildLeadTimeDays: 2,
      medianLatenessDays: null,
    })
    expect(receipts).toEqual([
      { day: '2026-10-01', quantity: 10 },
      { day: '2026-09-26', quantity: 5 },
    ])
  })
})
