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

  it('gives the column holding the tallest section no more sections than the other', () => {
    const { left, right } = splitPostingColumns(POSTING_PAGE_POLICIES)
    const tallest = POSTING_PAGE_POLICIES.reduce((a, b) =>
      postingSectionUnits(b) > postingSectionUnits(a) ? b : a
    )
    const withTallest = left.includes(tallest) ? left : right
    const other = withTallest === left ? right : left

    expect(withTallest.length).toBeLessThanOrEqual(other.length)
  })

  it('answers empty for an empty list', () => {
    expect(splitPostingColumns([])).toEqual({ left: [], right: [] })
  })
})

describe('postingSectionUnits', () => {
  // No shipped policy carries an input setting today, so the tall case is built here.
  it('grows with the settings a policy renders as inputs', () => {
    const writeOff = POSTING_PAGE_POLICIES.find((policy) => policy.type === 'write_off')
    expect(writeOff).toBeTruthy()

    const withSettings: PostingPolicy = {
      ...writeOff!,
      settings: [...writeOff!.settings, 'test.one', 'test.two', 'test.three', 'test.four'],
    }
    expect(postingSectionUnits(withSettings)).toBeGreaterThan(postingSectionUnits(writeOff!))
    expect(postingSectionUnits(withSettings)).toBeGreaterThan(
      Math.max(...POSTING_PAGE_POLICIES.map(postingSectionUnits))
    )
  })
})
