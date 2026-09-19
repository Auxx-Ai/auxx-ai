// apps/web/src/components/accounting/ui/settings/__tests__/posting-columns.test.ts

import type { PostingPolicy } from '@auxx/lib/accounting/ledger/client'
import { describe, expect, it } from 'vitest'
import {
  NOT_POSTING_SECTION_UNITS,
  POSTING_PAGE_POLICIES,
  postingSectionUnits,
  splitPostingColumns,
} from '../posting-page-model'

function units(policies: readonly PostingPolicy[]): number {
  return policies.reduce((total, policy) => total + postingSectionUnits(policy), 0)
}

describe('splitPostingColumns', () => {
  it('keeps the declared order down each column', () => {
    const { left, right } = splitPostingColumns(POSTING_PAGE_POLICIES)

    expect([...left, ...right].map((policy) => policy.type)).toEqual(
      POSTING_PAGE_POLICIES.map((policy) => policy.type)
    )
  })

  // The tallest section, not the shortest: a cut that may only fall between two
  // sections can be off by the one it could not split, and which section that
  // is depends on the declared order. It read `shortest` until
  // `landed_cost_clear` (74 D4) made the best available cut 170 units off.
  it('leaves both columns populated and ending within one section of each other', () => {
    const { left, right } = splitPostingColumns(POSTING_PAGE_POLICIES)
    const tallest = Math.max(...POSTING_PAGE_POLICIES.map(postingSectionUnits))

    expect(left.length).toBeGreaterThan(0)
    expect(right.length).toBeGreaterThan(0)
    expect(Math.abs(units(left) - (units(right) + NOT_POSTING_SECTION_UNITS))).toBeLessThanOrEqual(
      tallest
    )
  })

  it('gives the column holding a tall section fewer sections', () => {
    const { left, right } = splitPostingColumns(POSTING_PAGE_POLICIES)
    const withPayment = left.some((policy) => policy.type === 'payment') ? left : right
    const other = withPayment === left ? right : left

    expect(withPayment.length).toBeLessThan(other.length + 1)
  })

  it('answers empty for an empty list', () => {
    expect(splitPostingColumns([])).toEqual({ left: [], right: [] })
  })
})

describe('postingSectionUnits', () => {
  it('grows with the settings a policy renders as inputs', () => {
    const payment = POSTING_PAGE_POLICIES.find((policy) => policy.type === 'payment')
    const writeOff = POSTING_PAGE_POLICIES.find((policy) => policy.type === 'write_off')

    expect(payment && writeOff).toBeTruthy()
    expect(postingSectionUnits(payment!)).toBeGreaterThan(2 * postingSectionUnits(writeOff!))
  })
})
