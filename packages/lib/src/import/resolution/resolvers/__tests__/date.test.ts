// packages/lib/src/import/resolution/resolvers/__tests__/date.test.ts

import { afterEach, describe, expect, it } from 'vitest'
import type { ResolutionConfig } from '../../../types/resolution'
import { resolveDateCustom, resolveDateIso } from '../date'

const none: ResolutionConfig = {}
const dmy: ResolutionConfig = { dateFormat: 'dd/MM/yyyy' }

/**
 * Zones on both sides of UTC plus one past the date line. A DATE cell must
 * resolve to the same day in all of them; before this the resolvers froze a
 * host-local midnight, which read as the previous day everywhere east of UTC.
 */
const ZONES = ['Europe/Berlin', 'America/Los_Angeles', 'Pacific/Auckland'] as const

const originalTz = process.env.TZ

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

/** The resolved value, or a marker so a failure reads clearly. */
function read(
  resolve: typeof resolveDateIso,
  raw: string,
  config: ResolutionConfig = none
): unknown {
  const result = resolve(raw, config)
  return result.type === 'error' ? `ERROR: ${result.error}` : result.value
}

describe('resolveDateIso: a DATE cell is a calendar day, not a host-local instant', () => {
  for (const zone of ZONES) {
    it(`emits the typed day as a bare YYYY-MM-DD in ${zone}`, () => {
      process.env.TZ = zone
      expect(read(resolveDateIso, '2026-05-10')).toBe('2026-05-10')
      expect(read(resolveDateIso, ' 2026-05-10 ')).toBe('2026-05-10')
      // Year boundary and a DST switch day: the local fields still name the day.
      expect(read(resolveDateIso, '2026-12-31')).toBe('2026-12-31')
      expect(read(resolveDateIso, '2026-03-29')).toBe('2026-03-29')
    })
  }

  it('never emits an instant for a bare day, whatever the host zone', () => {
    for (const zone of ZONES) {
      process.env.TZ = zone
      const value = read(resolveDateIso, '2026-05-10')
      expect(typeof value).toBe('string')
      expect(value).not.toContain('T')
    }
  })

  for (const zone of ZONES) {
    it(`keeps a cell that carries a time as a full ISO instant in ${zone}`, () => {
      // `date:iso` is offered on DATETIME targets too; a real datetime cell
      // must not lose its time. On a DATE target the write funnel rounds it.
      process.env.TZ = zone
      expect(read(resolveDateIso, '2026-05-10T14:30:00Z')).toBe('2026-05-10T14:30:00.000Z')
      expect(read(resolveDateIso, '2026-05-10T00:00:00+02:00')).toBe('2026-05-09T22:00:00.000Z')
      expect(read(resolveDateIso, '2026-05-10 14:30:00Z')).toBe('2026-05-10T14:30:00.000Z')
    })
  }

  it('reads a blank cell as null', () => {
    expect(read(resolveDateIso, '')).toBeNull()
    expect(read(resolveDateIso, '   ')).toBeNull()
  })

  it('refuses a cell that is not an ISO date', () => {
    expect(read(resolveDateIso, '10/05/2026')).toMatch(/Invalid ISO date/)
    expect(read(resolveDateIso, 'May 10, 2026')).toMatch(/Invalid ISO date/)
    expect(read(resolveDateIso, '2026-13-40')).toMatch(/Invalid ISO date/)
  })
})

describe('resolveDateCustom: the same day in every zone', () => {
  for (const zone of ZONES) {
    it(`emits the typed day as a bare YYYY-MM-DD in ${zone}`, () => {
      process.env.TZ = zone
      expect(read(resolveDateCustom, '10/05/2026', dmy)).toBe('2026-05-10')
      expect(read(resolveDateCustom, '31/12/2026', dmy)).toBe('2026-12-31')
      expect(read(resolveDateCustom, '01/01/2026', dmy)).toBe('2026-01-01')
    })
  }

  it('honours the configured format', () => {
    expect(read(resolveDateCustom, '05/10/2026', { dateFormat: 'MM/dd/yyyy' })).toBe('2026-05-10')
    expect(read(resolveDateCustom, '10.05.2026', { dateFormat: 'dd.MM.yyyy' })).toBe('2026-05-10')
  })

  it('reads a blank cell as null', () => {
    expect(read(resolveDateCustom, '', dmy)).toBeNull()
  })

  it('refuses a cell that does not match the format', () => {
    expect(read(resolveDateCustom, '2026-05-10', dmy)).toMatch(/Invalid date for format/)
    expect(read(resolveDateCustom, '32/05/2026', dmy)).toMatch(/Invalid date for format/)
  })

  it('refuses to guess when no format is configured', () => {
    expect(read(resolveDateCustom, '10/05/2026', none)).toMatch(/Date format not configured/)
  })
})
