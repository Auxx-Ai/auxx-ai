// packages/lib/src/builds/__tests__/auto-build-policy.test.ts
//
// The four decisions the order-triggered auto-build makes without a database
// (plans/products/12-order-triggered-build.md §5.3, AB4, AB8). Pure — no
// doubles, no mocks, nothing to set up.

import { describe, expect, it } from 'vitest'
import {
  isCoveredByStock,
  isWithinEnablementWindow,
  parseAutoBuildEnabledAt,
  resolveAutoBuildStatus,
  resolveAutoBuildStockRule,
  sumQuantityByPart,
} from '../auto-build-policy'

const LIFT = 'part_lift'
const HOIST = 'part_hoist'

describe('sumQuantityByPart — one build per PART, not per line (§5.3 step 6)', () => {
  it('collapses two lines of the SAME part into one entry for the sum', () => {
    const totals = sumQuantityByPart([
      { partId: LIFT, quantity: 2 },
      { partId: LIFT, quantity: 3 },
    ])
    expect(totals.size).toBe(1)
    expect(totals.get(LIFT)).toBe(5)
  })

  it('keeps different parts apart', () => {
    const totals = sumQuantityByPart([
      { partId: LIFT, quantity: 2 },
      { partId: HOIST, quantity: 1 },
      { partId: LIFT, quantity: 4 },
    ])
    expect([...totals.entries()].sort()).toEqual([
      [HOIST, 1],
      [LIFT, 6],
    ])
  })

  it('drops a line with no quantity, and a part whose lines sum to nothing', () => {
    const totals = sumQuantityByPart([
      { partId: LIFT, quantity: 0 },
      { partId: HOIST, quantity: Number.NaN },
      { partId: HOIST, quantity: -3 },
    ])
    expect(totals.size).toBe(0)
  })
})

describe('isCoveredByStock — AB4', () => {
  it('out_of_stock_only skips a part the shelf already covers', () => {
    expect(isCoveredByStock('out_of_stock_only', 10, 4)).toBe(true)
    expect(isCoveredByStock('out_of_stock_only', 4, 4)).toBe(true)
  })

  it('out_of_stock_only fires for a part the shelf does not cover', () => {
    expect(isCoveredByStock('out_of_stock_only', 3, 4)).toBe(false)
    expect(isCoveredByStock('out_of_stock_only', 0, 1)).toBe(false)
    expect(isCoveredByStock('out_of_stock_only', -2, 1)).toBe(false)
  })

  it('all_stock_levels never treats anything as covered — that is what it means', () => {
    expect(isCoveredByStock('all_stock_levels', 1000, 1)).toBe(false)
  })
})

describe('resolveAutoBuildStockRule — the SAFE value is the default (AB4)', () => {
  it('defaults an unset, unknown or malformed value to out_of_stock_only', () => {
    expect(resolveAutoBuildStockRule(undefined)).toBe('out_of_stock_only')
    expect(resolveAutoBuildStockRule(null)).toBe('out_of_stock_only')
    expect(resolveAutoBuildStockRule('everything')).toBe('out_of_stock_only')
    expect(resolveAutoBuildStockRule(7)).toBe('out_of_stock_only')
  })

  it('honours an explicit all_stock_levels', () => {
    expect(resolveAutoBuildStockRule('all_stock_levels')).toBe('all_stock_levels')
  })
})

describe('resolveAutoBuildStatus — AB5', () => {
  it('is planned, and stays planned even when the stored value says otherwise', () => {
    // `completed` becomes selectable in phase 4, once `part_kind` is set on the
    // parts that are built. Until then an auto-complete aborts on every order.
    expect(resolveAutoBuildStatus('planned')).toBe('planned')
    expect(resolveAutoBuildStatus('completed')).toBe('planned')
    expect(resolveAutoBuildStatus(null)).toBe('planned')
  })
})

describe('parseAutoBuildEnabledAt', () => {
  it('reads an ISO string and a Date, and refuses anything else', () => {
    expect(parseAutoBuildEnabledAt('2026-08-27T10:00:00.000Z')?.toISOString()).toBe(
      '2026-08-27T10:00:00.000Z'
    )
    const date = new Date('2026-08-27T10:00:00.000Z')
    expect(parseAutoBuildEnabledAt(date)).toBe(date)
    expect(parseAutoBuildEnabledAt(null)).toBeNull()
    expect(parseAutoBuildEnabledAt('')).toBeNull()
    expect(parseAutoBuildEnabledAt('not a date')).toBeNull()
    expect(parseAutoBuildEnabledAt(1756288800000)).toBeNull()
  })
})

describe('isWithinEnablementWindow — AB8, the backlog cutoff', () => {
  const enabledAt = new Date('2026-08-27T00:00:00.000Z')

  it('accepts an order placed after the switch was turned on', () => {
    expect(isWithinEnablementWindow(new Date('2026-08-28T00:00:00.000Z'), enabledAt)).toBe(true)
  })

  it('accepts an order placed at the exact moment it was turned on', () => {
    expect(isWithinEnablementWindow(new Date(enabledAt), enabledAt)).toBe(true)
  })

  it('refuses an order placed before it — the whole point of the stamp', () => {
    expect(isWithinEnablementWindow(new Date('2025-01-01T00:00:00.000Z'), enabledAt)).toBe(false)
  })

  it('🛑 refuses EVERY order when no stamp was recorded', () => {
    // Guessing permissively here is what fires a build for every historical
    // order the moment a Shopify back-fill lands.
    expect(isWithinEnablementWindow(new Date('2030-01-01T00:00:00.000Z'), null)).toBe(false)
  })
})
