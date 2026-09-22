// apps/web/src/components/accounting/ui/banking/payouts/evidence-format.test.ts

import { describe, expect, it } from 'vitest'
import { formatEvidenceDate } from './evidence-format'

describe('payout source dates', () => {
  it('does not shift date-only provider evidence to a different local day', () => {
    expect(formatEvidenceDate('2026-09-15')).toBe('2026-09-15')
  })

  it('labels exact timestamps with their displayed timezone', () => {
    expect(formatEvidenceDate('2026-09-15T01:30:00-07:00')).toBe('2026-09-15 08:30:00 UTC')
    expect(formatEvidenceDate(null)).toBe('Not reported')
  })
})
