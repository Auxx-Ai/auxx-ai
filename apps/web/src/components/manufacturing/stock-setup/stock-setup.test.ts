// apps/web/src/components/manufacturing/stock-setup/stock-setup.test.ts

import { describe, expect, it } from 'vitest'
import { booksStartLabel } from './accounting-status-line'
import { STOCK_SETUP_HREF, stockSetupHref } from './stock-setup-href'
import { firstOpenStep, resolveStepStates, type StockSetupStatus } from './use-stock-setup'

function status(overrides: Partial<StockSetupStatus> = {}): StockSetupStatus {
  return {
    kindConflictCount: 0,
    unconfirmedKindCount: 0,
    unbuiltPartCount: 0,
    buildsSkipped: false,
    countingDone: false,
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

describe('booksStartLabel', () => {
  it('names the month after the cutoff', () => {
    expect(booksStartLabel('2025-11')).toBe('Dec 2025')
    expect(booksStartLabel('2025-12')).toBe('Jan 2026')
  })
})
