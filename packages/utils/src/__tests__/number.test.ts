// packages/utils/src/__tests__/number.test.ts

import { describe, expect, it } from 'vitest'
import { formatNumberCompact } from '../number'

describe('formatNumberCompact', () => {
  it('renders small values as-is', () => {
    expect(formatNumberCompact(0)).toBe('0')
    expect(formatNumberCompact(950)).toBe('950')
    expect(formatNumberCompact(360.5)).toBe('360.5')
  })

  it('compacts thousands / millions / billions', () => {
    expect(formatNumberCompact(1200)).toBe('1.2K')
    expect(formatNumberCompact(12000)).toBe('12K')
    expect(formatNumberCompact(2_300_000)).toBe('2.3M')
    expect(formatNumberCompact(1_500_000_000)).toBe('1.5B')
  })

  it('handles negatives', () => {
    expect(formatNumberCompact(-1200)).toBe('-1.2K')
  })

  it('honors maximumFractionDigits', () => {
    expect(formatNumberCompact(1234, 2)).toBe('1.23K')
    expect(formatNumberCompact(1234, 0)).toBe('1K')
  })

  it('renders a dash for nullish / non-finite values', () => {
    expect(formatNumberCompact(null)).toBe('-')
    expect(formatNumberCompact(undefined)).toBe('-')
    expect(formatNumberCompact(Number.NaN)).toBe('-')
  })
})
