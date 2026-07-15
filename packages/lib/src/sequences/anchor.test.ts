// packages/lib/src/sequences/anchor.test.ts

import { describe, expect, it } from 'vitest'
import { computeAnchorTarget, isPastAnchor } from './anchor'

// Same calendar anchors as `delivery-window.test.ts` / `recurrence/expand.test.ts`'s DST suite:
// 2026 spring-forward: America/New_York jumps 2:00 AM EST -> 3:00 AM EDT on Sun 2026-03-08.

describe('computeAnchorTarget — offset math', () => {
  it('applies a negative offset (before the anchor date)', () => {
    // Anchor: 2026-03-10T13:00:00Z (09:00 EDT). -2 days @ 09:00 -> 2026-03-08 09:00 EDT
    // (2026-03-08 is the spring-forward day itself, but 09:00 local is already past the
    // 2am transition, so it's EDT/UTC-4 -> 13:00 UTC).
    const anchor = new Date('2026-03-10T13:00:00Z')
    const target = computeAnchorTarget(
      anchor,
      { offsetDays: -2, timeOfDay: '09:00' },
      'America/New_York'
    )
    expect(target?.toISOString()).toBe('2026-03-08T13:00:00.000Z')
  })

  it('applies a zero offset (same day, different time-of-day)', () => {
    const anchor = new Date('2026-03-10T13:00:00Z') // 09:00 EDT
    const target = computeAnchorTarget(
      anchor,
      { offsetDays: 0, timeOfDay: '07:30' },
      'America/New_York'
    )
    expect(target?.toISOString()).toBe('2026-03-10T11:30:00.000Z')
  })

  it('applies a positive offset (after the anchor date)', () => {
    const anchor = new Date('2026-03-10T13:00:00Z') // 09:00 EDT
    const target = computeAnchorTarget(
      anchor,
      { offsetDays: 3, timeOfDay: '09:00' },
      'America/New_York'
    )
    expect(target?.toISOString()).toBe('2026-03-13T13:00:00.000Z')
  })

  it('falls back to the anchor date wall-clock time when timeOfDay is null', () => {
    const anchor = new Date('2026-03-10T14:30:00Z') // 10:30 EDT
    const target = computeAnchorTarget(
      anchor,
      { offsetDays: 1, timeOfDay: null },
      'America/New_York'
    )
    expect(target?.toISOString()).toBe('2026-03-11T14:30:00.000Z')
  })

  it('returns null for a null anchor date (decision #10 NULL-anchor skip)', () => {
    const target = computeAnchorTarget(
      null,
      { offsetDays: -2, timeOfDay: '09:00' },
      'America/New_York'
    )
    expect(target).toBeNull()
  })
})

describe('computeAnchorTarget — timezone handling', () => {
  it('interprets timeOfDay in the given IANA timezone, not UTC', () => {
    // Anchor 2026-07-15T20:00Z = 13:00 PDT (UTC-7), still July 15 locally. 09:00 in
    // America/Los_Angeles on that same local day (PDT, UTC-7) = 16:00 UTC.
    const anchor = new Date('2026-07-15T20:00:00Z')
    const target = computeAnchorTarget(
      anchor,
      { offsetDays: 0, timeOfDay: '09:00' },
      'America/Los_Angeles'
    )
    expect(target?.toISOString()).toBe('2026-07-15T16:00:00.000Z')
  })

  it('crosses the spring-forward DST transition correctly', () => {
    // Anchor Fri 2026-03-06 (EST, UTC-5); +2 days @ 09:00 lands on Sun 2026-03-08, the
    // transition day itself (EDT, UTC-4 from 2am) -> 09:00 EDT = 13:00 UTC.
    const anchor = new Date('2026-03-06T12:00:00Z')
    const target = computeAnchorTarget(
      anchor,
      { offsetDays: 2, timeOfDay: '09:00' },
      'America/New_York'
    )
    expect(target?.toISOString()).toBe('2026-03-08T13:00:00.000Z')
  })
})

describe('isPastAnchor', () => {
  it('treats a null target as past (NULL-anchor skip)', () => {
    expect(isPastAnchor(null)).toBe(true)
  })

  it('treats a target before now as past', () => {
    const now = new Date('2026-07-15T12:00:00Z')
    expect(isPastAnchor(new Date('2026-07-15T11:59:59Z'), now)).toBe(true)
  })

  it('treats a target exactly at now as past (inclusive)', () => {
    const now = new Date('2026-07-15T12:00:00Z')
    expect(isPastAnchor(new Date('2026-07-15T12:00:00Z'), now)).toBe(true)
  })

  it('treats a target after now as not past', () => {
    const now = new Date('2026-07-15T12:00:00Z')
    expect(isPastAnchor(new Date('2026-07-15T12:00:01Z'), now)).toBe(false)
  })
})
