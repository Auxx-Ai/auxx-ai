// packages/lib/src/field-values/__tests__/calendar-day.test.ts

import { describe, expect, it } from 'vitest'
import { fromCalendarDayIso, normalizeCalendarDayIso, toCalendarDayIso } from '../calendar-day'
import { calendarDateConverter } from '../converters/calendar-date'
import { dateConverter } from '../converters/date'
import { converters } from '../converters/index'
import { validateSingleValue } from '../field-value-helpers'
import { FieldValueValidator, fieldValueSchemas } from '../field-value-validator'

const MAY_10 = '2026-05-10T00:00:00.000Z'
const MAY_9 = '2026-05-09T00:00:00.000Z'

/**
 * Local-midnight instants a browser date picker at each zone emits for May 10,
 * 2026. Auckland is UTC+12 in May (NZST), so its local midnight is exactly the
 * 12h boundary that must round UP to May 10.
 */
const ZONES = [
  { tz: 'Europe/Berlin', localMidnight: '2026-05-09T22:00:00.000Z' },
  { tz: 'America/Los_Angeles', localMidnight: '2026-05-10T07:00:00.000Z' },
  { tz: 'Pacific/Auckland', localMidnight: '2026-05-09T12:00:00.000Z' },
] as const

/**
 * Pin `TZ` for one case. Node re-reads `process.env.TZ` on assignment, so the
 * local-time `Date` accessors switch zone immediately; the sanity check inside
 * each zone block below proves it for this vitest setup.
 */
function withTz<T>(tz: string, fn: () => T): T {
  const previous = process.env.TZ
  process.env.TZ = tz
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
}

describe('normalizeCalendarDayIso', () => {
  for (const { tz, localMidnight } of ZONES) {
    describe(`in ${tz}`, () => {
      it('the zone is actually applied to local Date construction', () => {
        withTz(tz, () => {
          expect(new Date(2026, 4, 10).toISOString()).toBe(localMidnight)
        })
      })

      it('a bare YYYY-MM-DD is that day at UTC midnight', () => {
        withTz(tz, () => {
          expect(normalizeCalendarDayIso('2026-05-10')).toBe(MAY_10)
          expect(normalizeCalendarDayIso('  2026-05-10 ')).toBe(MAY_10)
        })
      })

      it('the local-midnight instant the picker emits lands on the intended day', () => {
        withTz(tz, () => {
          expect(normalizeCalendarDayIso(localMidnight)).toBe(MAY_10)
          expect(normalizeCalendarDayIso(new Date(2026, 4, 10))).toBe(MAY_10)
        })
      })

      it('a +02:00 offset instant (the workflow date-time node) lands on the intended day', () => {
        withTz(tz, () => {
          expect(normalizeCalendarDayIso('2026-05-10T00:00:00.000+02:00')).toBe(MAY_10)
        })
      })

      it('an epoch number rounds to the nearest UTC midnight', () => {
        withTz(tz, () => {
          expect(normalizeCalendarDayIso(Date.parse(localMidnight))).toBe(MAY_10)
          expect(normalizeCalendarDayIso(Date.parse(MAY_10))).toBe(MAY_10)
        })
      })
    })
  }

  it('rounds to the NEAREST midnight, with the exact 12h boundary going up', () => {
    expect(normalizeCalendarDayIso('2026-05-09T12:00:00.000Z')).toBe(MAY_10)
    expect(normalizeCalendarDayIso('2026-05-09T11:59:59.999Z')).toBe(MAY_9)
    expect(normalizeCalendarDayIso('2026-05-10T11:59:59.999Z')).toBe(MAY_10)
    expect(normalizeCalendarDayIso('2026-05-10T12:00:00.000Z')).toBe('2026-05-11T00:00:00.000Z')
  })

  it('leaves a canonical value untouched', () => {
    expect(normalizeCalendarDayIso(MAY_10)).toBe(MAY_10)
    expect(normalizeCalendarDayIso(new Date(MAY_10))).toBe(MAY_10)
  })

  it('returns null for empty input', () => {
    expect(normalizeCalendarDayIso(null)).toBeNull()
    expect(normalizeCalendarDayIso(undefined)).toBeNull()
    expect(normalizeCalendarDayIso('')).toBeNull()
    expect(normalizeCalendarDayIso('   ')).toBeNull()
  })

  it('returns null for garbage', () => {
    expect(normalizeCalendarDayIso('not a date')).toBeNull()
    expect(normalizeCalendarDayIso(new Date('garbage'))).toBeNull()
    expect(normalizeCalendarDayIso(Number.NaN)).toBeNull()
    expect(normalizeCalendarDayIso({ nope: 1 })).toBeNull()
    expect(normalizeCalendarDayIso(true)).toBeNull()
  })
})

describe('toCalendarDayIso / fromCalendarDayIso', () => {
  for (const { tz } of ZONES) {
    it(`round-trips the same Y/M/D in ${tz}`, () => {
      withTz(tz, () => {
        const picked = new Date(2026, 4, 10)
        const iso = toCalendarDayIso(picked)
        expect(iso).toBe(MAY_10)

        const back = fromCalendarDayIso(iso)
        expect(back).toBeDefined()
        expect(back!.getFullYear()).toBe(2026)
        expect(back!.getMonth()).toBe(4)
        expect(back!.getDate()).toBe(10)
        expect(back!.getHours()).toBe(0)
        expect(back!.getMinutes()).toBe(0)
      })
    })
  }

  it('fromCalendarDayIso highlights the intended day for a not-yet-backfilled picker row', () => {
    withTz('America/Los_Angeles', () => {
      // A Berlin picker wrote 22:00Z on May 9; a naive local read in LA shows May 9.
      expect(fromCalendarDayIso('2026-05-09T22:00:00.000Z')!.getDate()).toBe(10)
    })
  })

  it('fromCalendarDayIso returns undefined for empty or garbage', () => {
    expect(fromCalendarDayIso(null)).toBeUndefined()
    expect(fromCalendarDayIso('')).toBeUndefined()
    expect(fromCalendarDayIso('garbage')).toBeUndefined()
  })
})

describe('calendarDateConverter', () => {
  it('is what the DATE type routes to; DATETIME and TIME keep dateConverter', () => {
    expect(converters.DATE).toBe(calendarDateConverter)
    expect(converters.DATETIME).toBe(dateConverter)
    expect(converters.TIME).toBe(dateConverter)
  })

  describe('toTypedInput', () => {
    for (const { tz, localMidnight } of ZONES) {
      it(`normalises every input shape to UTC midnight in ${tz}`, () => {
        withTz(tz, () => {
          const expected = { type: 'date', value: MAY_10 }
          expect(calendarDateConverter.toTypedInput('2026-05-10')).toEqual(expected)
          expect(calendarDateConverter.toTypedInput(localMidnight)).toEqual(expected)
          expect(calendarDateConverter.toTypedInput(new Date(2026, 4, 10))).toEqual(expected)
          expect(calendarDateConverter.toTypedInput(Date.parse(localMidnight))).toEqual(expected)
          expect(calendarDateConverter.toTypedInput('2026-05-10T00:00:00.000+02:00')).toEqual(
            expected
          )
        })
      })
    }

    it('normalises the value inside an already-typed input', () => {
      expect(
        calendarDateConverter.toTypedInput({ type: 'date', value: '2026-05-09T22:00:00.000Z' })
      ).toEqual({ type: 'date', value: MAY_10 })
    })

    it('returns null for empty, garbage, and a typed value of another type', () => {
      expect(calendarDateConverter.toTypedInput(null)).toBeNull()
      expect(calendarDateConverter.toTypedInput(undefined)).toBeNull()
      expect(calendarDateConverter.toTypedInput('')).toBeNull()
      expect(calendarDateConverter.toTypedInput('garbage')).toBeNull()
      expect(calendarDateConverter.toTypedInput({ type: 'date', value: null })).toBeNull()
      expect(calendarDateConverter.toTypedInput({ type: 'text', value: '2026-05-10' })).toBeNull()
    })
  })

  describe('toRawValue', () => {
    it('emits the canonical UTC-midnight ISO string', () => {
      expect(calendarDateConverter.toRawValue({ type: 'date', value: MAY_10 })).toBe(MAY_10)
      expect(
        calendarDateConverter.toRawValue({ type: 'date', value: '2026-05-10T07:00:00.000Z' })
      ).toBe(MAY_10)
      expect(calendarDateConverter.toRawValue('2026-05-10')).toBe(MAY_10)
      expect(calendarDateConverter.toRawValue(new Date('2026-05-09T22:00:00.000Z'))).toBe(MAY_10)
    })

    it('returns null for empty or garbage', () => {
      expect(calendarDateConverter.toRawValue(null)).toBeNull()
      expect(calendarDateConverter.toRawValue('garbage')).toBeNull()
      expect(calendarDateConverter.toRawValue({ type: 'date', value: null })).toBeNull()
    })
  })

  describe('toDisplayValue', () => {
    const stored = { type: 'date' as const, value: MAY_10 }

    for (const { tz } of ZONES) {
      it(`renders the stored UTC day, not the viewer's local day, in ${tz}`, () => {
        withTz(tz, () => {
          for (const format of ['short', 'medium', 'long'] as const) {
            const rendered = calendarDateConverter.toDisplayValue(stored, { format }) as string
            expect(rendered).toBe(
              new Date(MAY_10).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: format })
            )
            expect(rendered).toMatch(/10/)
            expect(rendered).not.toMatch(/:/)
          }
        })
      })
    }

    it('differs from dateConverter west of UTC, which is the bug being fixed', () => {
      withTz('America/Los_Angeles', () => {
        const generic = dateConverter.toDisplayValue(stored, { format: 'iso' })
        expect(generic).toBe(MAY_10)
        // dateConverter renders midnight UTC as the previous evening in LA.
        expect(dateConverter.toDisplayValue(stored, { format: 'medium' })).toMatch(/9/)
        expect(calendarDateConverter.toDisplayValue(stored, { format: 'medium' })).toMatch(/10/)
      })
    })

    it('iso is the bare YYYY-MM-DD', () => {
      expect(calendarDateConverter.toDisplayValue(stored, { format: 'iso' })).toBe('2026-05-10')
    })

    it('rounds a not-yet-backfilled picker row onto its intended day', () => {
      expect(
        calendarDateConverter.toDisplayValue(
          { type: 'date', value: '2026-05-09T22:00:00.000Z' },
          { format: 'iso' }
        )
      ).toBe('2026-05-10')
    })

    it('ignores includeTime and time-only', () => {
      expect(
        calendarDateConverter.toDisplayValue(stored, { format: 'short', includeTime: true })
      ).not.toMatch(/:/)
      expect(calendarDateConverter.toDisplayValue(stored, { format: 'time-only' })).toBe(
        new Date(MAY_10).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium' })
      )
    })

    it('keeps relative working', () => {
      const today = { type: 'date' as const, value: toCalendarDayIso(new Date()) }
      const rendered = calendarDateConverter.toDisplayValue(today, { format: 'relative' })
      expect(typeof rendered).toBe('string')
      expect(rendered).not.toBe('')
      expect(rendered).not.toBe(today.value)
    })

    it('renders empty for a missing or garbage value', () => {
      expect(
        calendarDateConverter.toDisplayValue({ type: 'date', value: null as unknown as string })
      ).toBe('')
      expect(calendarDateConverter.toDisplayValue({ type: 'date', value: 'garbage' })).toBe('')
    })
  })
})

describe('FieldValueValidator.validateCalendarDate', () => {
  const validator = new FieldValueValidator()

  for (const { tz, localMidnight } of ZONES) {
    it(`normalises every input shape to UTC midnight in ${tz}`, () => {
      withTz(tz, () => {
        for (const input of [
          '2026-05-10',
          localMidnight,
          new Date(2026, 4, 10),
          '2026-05-10T00:00:00.000+02:00',
        ]) {
          const result = validator.validateCalendarDate(input)
          expect(result.success).toBe(true)
          expect(result.success && result.data).toBe(MAY_10)
        }
      })
    })
  }

  it('rejects empty and garbage with the same issue dateSchema reports', () => {
    for (const input of ['', '   ', null, undefined, 'garbage']) {
      const result = validator.validateCalendarDate(input)
      expect(result.success).toBe(false)
      expect(!result.success && result.error.issues[0]?.message).toBe('Invalid date value')
    }
  })

  it('is wired to fieldValueSchemas.calendarDate', () => {
    expect(fieldValueSchemas.calendarDate.safeParse('2026-05-10')).toEqual({
      success: true,
      data: MAY_10,
    })
  })
})

describe('validateSingleValue routes by type', () => {
  const ctx = { validator: new FieldValueValidator() } as never

  it('DATE goes through validateCalendarDate', async () => {
    await withTz('Europe/Berlin', async () => {
      await expect(
        validateSingleValue(ctx, '2026-05-09T22:00:00.000Z', 'DATE' as never)
      ).resolves.toEqual({ type: 'date', value: MAY_10 })
    })
  })

  it('DATETIME and TIME keep validateDate and the instant', async () => {
    for (const type of ['DATETIME', 'TIME']) {
      await expect(
        validateSingleValue(ctx, '2026-05-09T22:00:00.000Z', type as never)
      ).resolves.toEqual({ type: 'date', value: '2026-05-09T22:00:00.000Z' })
    }
  })
})

describe('DATETIME is byte-identical to before', () => {
  const validator = new FieldValueValidator()
  const inputs = [
    '2026-05-09T22:00:00.000Z',
    '2026-05-10T07:13:45.678Z',
    '2026-05-10T00:00:00.000+02:00',
    '2026-05-10',
  ]

  for (const { tz } of ZONES) {
    it(`dateConverter and validateDate still emit new Date(v).toISOString() in ${tz}`, () => {
      withTz(tz, () => {
        for (const input of inputs) {
          const expected = new Date(input).toISOString()
          expect(dateConverter.toTypedInput(input)).toEqual({ type: 'date', value: expected })
          expect(dateConverter.toRawValue(input)).toBe(expected)
          const validated = validator.validateDate(input)
          expect(validated.success && validated.data).toBe(expected)
        }

        const local = new Date(2026, 4, 10, 15, 30)
        expect(dateConverter.toTypedInput(local)).toEqual({
          type: 'date',
          value: local.toISOString(),
        })
        const validatedLocal = validator.validateDate(local)
        expect(validatedLocal.success && validatedLocal.data).toBe(local.toISOString())
      })
    })
  }

  it('dateConverter display still uses the viewer zone and honours includeTime', () => {
    withTz('America/Los_Angeles', () => {
      const stored = { type: 'date' as const, value: '2026-05-10T07:13:00.000Z' }
      expect(dateConverter.toDisplayValue(stored, { format: 'short', includeTime: true })).toBe(
        new Date(stored.value).toLocaleString(undefined, {
          timeZone: undefined,
          dateStyle: 'short',
          timeStyle: 'short',
        })
      )
      expect(dateConverter.toDisplayValue(stored, { format: 'iso' })).toBe(stored.value)
    })
  })
})
