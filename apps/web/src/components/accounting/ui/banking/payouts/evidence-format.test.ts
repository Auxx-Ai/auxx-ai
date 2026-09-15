// apps/web/src/components/accounting/ui/banking/payouts/evidence-format.test.ts

import { describe, expect, it } from 'vitest'
import { formatEvidenceAmount, formatEvidenceDate } from './evidence-format'

describe('payout source amounts', () => {
  it('preserves every minor unit beyond JavaScript safe integer capacity', () => {
    expect(formatEvidenceAmount('9007199254740993', 'USD', 2)).toBe('USD 90,071,992,547,409.93')
    expect(formatEvidenceAmount('-9007199254740993', 'USD', 2)).toBe('USD -90,071,992,547,409.93')
  })

  it('honors the source currency exponent, including zero and three decimal currencies', () => {
    expect(formatEvidenceAmount('1234', 'JPY', 0)).toBe('JPY 1,234')
    expect(formatEvidenceAmount('1234', 'KWD', 3)).toBe('KWD 1.234')
    expect(formatEvidenceAmount('1', 'KWD', 3)).toBe('KWD 0.001')
    expect(formatEvidenceAmount('-1', 'USD', 2)).toBe('USD -0.01')
    expect(formatEvidenceAmount('0', 'USD', 2)).toBe('USD 0.00')
  })
})

describe('payout source dates', () => {
  it('does not shift date-only provider evidence to a different local day', () => {
    expect(formatEvidenceDate('2026-09-15')).toBe('2026-09-15')
  })

  it('labels exact timestamps with their displayed timezone', () => {
    expect(formatEvidenceDate('2026-09-15T01:30:00-07:00')).toBe('2026-09-15 08:30:00 UTC')
    expect(formatEvidenceDate(null)).toBe('Not reported')
  })
})
