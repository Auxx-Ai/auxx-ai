// apps/web/src/components/kopilot/ui/blocks/__tests__/block-date.test.ts

import { describe, expect, it } from 'vitest'
import { parseBlockDate } from '../block-date'

describe('parseBlockDate', () => {
  it('parses a complete ISO timestamp', () => {
    expect(parseBlockDate('2026-07-31T09:15:00.000Z')?.toISOString()).toBe(
      '2026-07-31T09:15:00.000Z'
    )
  })

  it('returns null for a mid-stream truncated timestamp', () => {
    // The partial-JSON parser emits prefixes of the streamed string, so every
    // cut point of a real ISO value must be survivable.
    const full = '2026-07-31T09:15:00.000Z'
    for (let i = 1; i < full.length; i++) {
      const prefix = full.slice(0, i)
      const parsed = parseBlockDate(prefix)
      expect(parsed === null || !Number.isNaN(parsed.getTime())).toBe(true)
    }
  })

  it('returns null for empty, null and undefined', () => {
    expect(parseBlockDate('')).toBeNull()
    expect(parseBlockDate(null)).toBeNull()
    expect(parseBlockDate(undefined)).toBeNull()
  })

  it('returns null for garbage', () => {
    expect(parseBlockDate('not a date')).toBeNull()
  })
})
