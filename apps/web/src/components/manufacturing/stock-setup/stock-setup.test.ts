// apps/web/src/components/manufacturing/stock-setup/stock-setup.test.ts

import { describe, expect, it } from 'vitest'
import {
  booksStartDate,
  booksStartDateFromCutoverDay,
  formatBooksDay,
} from '~/components/accounting/books-start'
import { fixAccountsCopy, listPartNames, type MovementAccountDrift } from './fix-accounts-copy'
import { STOCK_SETUP_HREF, stockSetupHref } from './stock-setup-href'
import { firstOpenStep, resolveStepStates, type StockSetupStatus } from './use-stock-setup'

function status(overrides: Partial<StockSetupStatus> = {}): StockSetupStatus {
  return {
    kindConflictCount: 0,
    unconfirmedKindCount: 0,
    unbuiltPartCount: 0,
    buildsSkipped: false,
    countingDone: false,
    movedPartCount: 0,
    countedPartCount: 0,
    uncostedPartCount: 0,
    hasStockedMovements: true,
    steps: { kinds: true, builds: true, count: false },
    ...overrides,
  }
}

describe('stockSetupHref', () => {
  it('links the page, a step, and keeps prefilters', () => {
    expect(stockSetupHref()).toBe(STOCK_SETUP_HREF)
    expect(stockSetupHref('builds')).toBe('/app/inventory/setup?step=builds')
    expect(stockSetupHref('count', { parts: 'a,b' })).toBe(
      '/app/inventory/setup?step=count&parts=a%2Cb'
    )
  })
})

describe('resolveStepStates', () => {
  it('reads a skipped builds step as skipped, not done', () => {
    const states = resolveStepStates(
      status({
        unbuiltPartCount: 3,
        buildsSkipped: true,
        steps: { kinds: true, builds: true, count: false },
      })
    )
    expect(states).toEqual({ kinds: 'done', builds: 'skipped', count: 'todo' })
  })

  it('opens on the first step still to do', () => {
    expect(
      firstOpenStep(
        resolveStepStates(status({ steps: { kinds: false, builds: true, count: false } }))
      )
    ).toBe('kinds')
    expect(
      firstOpenStep(
        resolveStepStates(
          status({ unbuiltPartCount: 2, steps: { kinds: true, builds: false, count: false } })
        )
      )
    ).toBe('builds')
    expect(
      firstOpenStep(
        resolveStepStates(status({ steps: { kinds: true, builds: true, count: true } }))
      )
    ).toBe('count')
  })
})

describe('booksStartDate', () => {
  it('names the first day after the cutoff month', () => {
    expect(booksStartDate('2025-11')).toBe('1 Dec 2025')
    expect(booksStartDate('2025-12')).toBe('1 Jan 2026')
    expect(booksStartDate('2026-08')).toBe('1 Sep 2026')
  })

  it('names the day after a closing day', () => {
    expect(booksStartDateFromCutoverDay('2025-12-31')).toBe('1 Jan 2026')
    expect(booksStartDateFromCutoverDay('2024-02-28')).toBe('29 Feb 2024')
  })

  it('formats any day the same way', () => {
    expect(formatBooksDay('2026-01-15')).toBe('15 Jan 2026')
  })

  it('passes through what it cannot read', () => {
    expect(booksStartDate('2025-12-31')).toBe('2025-12-31')
    expect(booksStartDateFromCutoverDay('2025-12')).toBe('2025-12')
  })
})

function drift(overrides: Partial<MovementAccountDrift> = {}): MovementAccountDrift {
  const part = (partName: string, movementCount: number) => ({
    partId: partName,
    partName,
    currentKind: 'component',
    expectedAccountRole: 'inventory_raw_materials',
    fromAccountRoles: ['inventory_finished_goods'],
    movementCount,
    unpostedCount: movementCount,
    postedCount: 0,
  })
  return {
    parts: [part('Box 1', 20000), part('Box 2', 18000), part('Square Nut M5', 120)],
    movementCount: 38120,
    unpostedCount: 38120,
    postedCount: 0,
    ...overrides,
  }
}

describe('fixAccountsCopy', () => {
  it('names the parts, the kind and both accounts', () => {
    const copy = fixAccountsCopy(drift())
    expect(copy.title).toBe('3 parts changed kind after their movements were recorded')
    expect(copy.lead).toBe(
      `Box 1, Box 2 and Square Nut M5 are now Components, but ${(38120).toLocaleString()} of their past movements still carry the Finished Goods account.`
    )
    expect(copy.tail).toBe(
      'moves them to Raw Materials. Quantities, dates and builds stay exactly as they are.'
    )
    expect(copy.posted).toBeNull()
  })

  it('adds the booked line only when some movements are posted', () => {
    const copy = fixAccountsCopy(drift({ postedCount: 412 }))
    expect(copy.posted).toBe(
      '412 of them are already in your books. Those stay as they are; one correcting entry per part moves their value instead.'
    )
    expect(copy.confirm).toContain('412 already in your books')
  })

  it('lists up to three names, then counts the rest', () => {
    expect(listPartNames(['A'])).toBe('A')
    expect(listPartNames(['A', 'B'])).toBe('A and B')
    expect(listPartNames(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more')
  })
})
