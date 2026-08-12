// packages/lib/src/workflow-engine/nodes/wait/target-time.test.ts

import { describe, expect, it } from 'vitest'
import { resolveTargetTime } from './target-time'

describe('resolveTargetTime', () => {
  describe('with a timezone', () => {
    it('reads a bare wall-clock string as local to the timezone', () => {
      // 09:00 in New York during EDT (UTC-4)
      expect(resolveTargetTime('2026-09-01T09:00', 'America/New_York').toISOString()).toBe(
        '2026-09-01T13:00:00.000Z'
      )
    })

    it('honours the timezone across a DST boundary', () => {
      // Same wall-clock time in January is EST (UTC-5), an hour further out
      expect(resolveTargetTime('2026-01-15T09:00', 'America/New_York').toISOString()).toBe(
        '2026-01-15T14:00:00.000Z'
      )
    })

    it('resolves different zones to different instants', () => {
      const ny = resolveTargetTime('2026-09-01T09:00', 'America/New_York')
      const berlin = resolveTargetTime('2026-09-01T09:00', 'Europe/Berlin')
      expect(berlin.toISOString()).toBe('2026-09-01T07:00:00.000Z')
      expect(ny.getTime() - berlin.getTime()).toBe(6 * 60 * 60 * 1000)
    })

    it('accepts a space-separated wall-clock string', () => {
      expect(resolveTargetTime('2026-09-01 09:00', 'America/New_York').toISOString()).toBe(
        '2026-09-01T13:00:00.000Z'
      )
    })

    it('accepts seconds in the wall-clock string', () => {
      expect(resolveTargetTime('2026-09-01T09:00:30', 'America/New_York').toISOString()).toBe(
        '2026-09-01T13:00:30.000Z'
      )
    })

    it('does NOT re-shift a value that already carries a UTC designator', () => {
      expect(resolveTargetTime('2026-09-01T09:00:00Z', 'America/New_York').toISOString()).toBe(
        '2026-09-01T09:00:00.000Z'
      )
    })

    it('does NOT re-shift a value that already carries a numeric offset', () => {
      expect(resolveTargetTime('2026-09-01T09:00:00+02:00', 'America/New_York').toISOString()).toBe(
        '2026-09-01T07:00:00.000Z'
      )
    })

    it('trims surrounding whitespace', () => {
      expect(resolveTargetTime('  2026-09-01T09:00  ', 'America/New_York').toISOString()).toBe(
        '2026-09-01T13:00:00.000Z'
      )
    })

    it('throws a legible error for an unknown timezone', () => {
      expect(() => resolveTargetTime('2026-09-01T09:00', 'Not/AZone')).toThrow(
        'Unknown timezone "Not/AZone" on wait node'
      )
    })
  })

  describe('without a timezone', () => {
    it('parses an absolute value unchanged', () => {
      expect(resolveTargetTime('2026-09-01T09:00:00Z').toISOString()).toBe(
        '2026-09-01T09:00:00.000Z'
      )
    })

    it('falls back to plain Date parsing for a bare wall-clock string', () => {
      expect(resolveTargetTime('2026-09-01T09:00').getTime()).toBe(
        new Date('2026-09-01T09:00').getTime()
      )
    })

    it('treats an empty timezone as no timezone', () => {
      expect(resolveTargetTime('2026-09-01T09:00', '').getTime()).toBe(
        new Date('2026-09-01T09:00').getTime()
      )
    })
  })

  describe('non-string inputs', () => {
    it('passes a Date through untouched', () => {
      const date = new Date('2026-09-01T09:00:00Z')
      expect(resolveTargetTime(date, 'America/New_York')).toBe(date)
    })

    it('reads a number as epoch milliseconds', () => {
      expect(resolveTargetTime(1_756_724_400_000, 'America/New_York').getTime()).toBe(
        1_756_724_400_000
      )
    })

    it('returns an Invalid Date for an unusable value', () => {
      expect(Number.isNaN(resolveTargetTime(undefined).getTime())).toBe(true)
      expect(Number.isNaN(resolveTargetTime(null).getTime())).toBe(true)
      expect(Number.isNaN(resolveTargetTime('nonsense', 'America/New_York').getTime())).toBe(true)
    })
  })
})
