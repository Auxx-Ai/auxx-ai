// apps/web/src/components/manufacturing/parts/opening-stock-input.test.ts

import { describe, expect, it } from 'vitest'
import {
  buildOpeningStockInput,
  describeSetCountPosting,
  setCountPostingSentence,
  validateOpeningStock,
} from './opening-stock-input'

describe('buildOpeningStockInput', () => {
  it('sends a count of zero and treats the cost as optional', () => {
    expect(
      buildOpeningStockInput('p1', {
        quantity: 0,
        unitCost: null,
        occurredAt: '2026-09-25T00:00:00.000Z',
      })
    ).toEqual({ partId: 'p1', quantity: 0, day: '2026-09-25' })
  })

  it('rounds a typed cost to whole minor units', () => {
    expect(
      buildOpeningStockInput('p1', {
        quantity: 3,
        unitCost: 2050.4,
        occurredAt: '2026-09-25T00:00:00.000Z',
      })
    ).toMatchObject({ unitCost: 2050 })
  })

  it('refuses a missing or negative count', () => {
    expect(
      buildOpeningStockInput('p1', {
        quantity: null,
        unitCost: null,
        occurredAt: '2026-09-25T00:00:00.000Z',
      })
    ).toBeNull()
    expect(validateOpeningStock({ quantity: -1, unitCost: null, occurredAt: '' })).toHaveProperty(
      'quantity'
    )
    expect(validateOpeningStock({ quantity: 0, unitCost: null, occurredAt: '' })).toEqual({})
  })
})

describe('describeSetCountPosting (111 Q19)', () => {
  it('posts nothing while accounting is off', () => {
    const posting = describeSetCountPosting({
      occurredAt: '2026-09-25T00:00:00.000Z',
      partKind: 'component',
      cutoffPeriod: '2025-12',
      accountingActive: false,
    })
    expect(posting).toEqual({ kind: 'off' })
    expect(setCountPostingSentence(posting)).toMatch(/nothing is posted/)
  })

  it('is covered by the opening at or before the cutover', () => {
    expect(
      describeSetCountPosting({
        occurredAt: '2025-12-31T00:00:00.000Z',
        partKind: 'component',
        cutoffPeriod: '2025-12',
        accountingActive: true,
      })
    ).toEqual({ kind: 'covered', cutoverDate: '2025-12-31' })
  })

  it('posts to Count Variance after the cutover, against the kind’s inventory account', () => {
    const posting = describeSetCountPosting({
      occurredAt: '2026-01-01T00:00:00.000Z',
      partKind: 'finished_good',
      cutoffPeriod: '2025-12',
      accountingActive: true,
    })
    expect(posting).toEqual({
      kind: 'variance',
      inventoryAccount: '1330 Finished Goods',
      varianceAccount: '5095 Inventory Count Variance',
    })
    expect(setCountPostingSentence(posting)).toContain('5095 Inventory Count Variance')
  })
})
