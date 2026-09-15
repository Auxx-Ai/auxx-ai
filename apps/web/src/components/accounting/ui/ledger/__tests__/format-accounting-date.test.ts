// apps/web/src/components/accounting/ui/ledger/__tests__/format-accounting-date.test.ts
//
// `formatAccountingDate` takes two shapes and must not confuse them. A bare
// `YYYY-MM-DD` key is already a calendar day in the book zone and renders as
// that day whatever the zone; a real timestamp is an instant and renders on
// the day it falls in the book zone. Brief 28 §6 found the first case printing
// the previous day for every org west of Greenwich.

import type { RailFeeStatus } from '@auxx/lib/postings/client'
import { describe, expect, it } from 'vitest'
import { formatAccountingDate, railFeeSentence } from '../format'

const LOS_ANGELES = 'America/Los_Angeles'

describe('formatAccountingDate', () => {
  it('renders a YYYY-MM-DD key as that calendar day, with no zone shift', () => {
    expect(formatAccountingDate('2026-09-01', LOS_ANGELES)).toBe('Sep 1, 2026')
    expect(formatAccountingDate('2026-09-01', 'UTC')).toBe('Sep 1, 2026')
    expect(formatAccountingDate('2026-09-01', 'Pacific/Auckland')).toBe('Sep 1, 2026')
  })

  it('renders the first and last day of a year without borrowing from the neighbour', () => {
    expect(formatAccountingDate('2026-01-01', LOS_ANGELES)).toBe('Jan 1, 2026')
    expect(formatAccountingDate('2025-12-31', 'Pacific/Auckland')).toBe('Dec 31, 2025')
  })

  it('still renders a real timestamp on the day it falls in the book zone', () => {
    // 03:00 UTC on Sep 1 is still Aug 31 in Los Angeles.
    expect(formatAccountingDate('2026-09-01T03:00:00.000Z', LOS_ANGELES)).toBe('Aug 31, 2026')
    expect(formatAccountingDate('2026-09-01T03:00:00.000Z', 'UTC')).toBe('Sep 1, 2026')
  })

  it('returns an unparseable string unchanged', () => {
    expect(formatAccountingDate('not a date', LOS_ANGELES)).toBe('not a date')
  })
})

describe('railFeeSentence reads the booked day as a calendar day', () => {
  it('quotes the same day west of Greenwich as in UTC', () => {
    const rail: RailFeeStatus = {
      paymentGatewayId: 'pg_1',
      name: 'Authorize.net',
      feeTreatment: 'billed',
      tradedInMonth: true,
      fees: {
        kind: 'own',
        glAccountId: 'gl_6150',
        bookedInMonth: true,
        lastBookedAt: '2026-09-01',
      },
    }
    expect(railFeeSentence(rail, '2026-09', LOS_ANGELES)).toBe(
      'Billed separately. Last fee booked Sep 1, 2026, in September 2026.'
    )
  })
})
