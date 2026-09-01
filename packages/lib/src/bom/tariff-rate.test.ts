// packages/lib/src/bom/tariff-rate.test.ts
//
// The resolution rule (plans/money/tasks/29-tariff-schedule.md §3) is the
// load-bearing half of the tariff schedule and it is shared between the cost
// calculator and the browser, so its contract is pinned here rather than
// asserted indirectly through whatever happens to call it.

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../errors'
import { resolveTariffRate, type TariffRateRow } from './vendor-cost'

/** A rate row. `rate` is a percentage and `effectiveFrom` is a calendar day. */
function rateRow(id: string, overrides: Partial<TariffRateRow> = {}): TariffRateRow {
  return {
    id,
    authority: null,
    rate: 0,
    effectiveFrom: '2019-01-01',
    chapter99Code: null,
    ...overrides,
  }
}

/** The §2 worked example: one code, three authorities, effective rate 47%. */
const CHINESE_VALVE: TariffRateRow[] = [
  rateRow('mfn', { authority: 'MFN', rate: 2, effectiveFrom: '1995-01-01' }),
  rateRow('s301', {
    authority: 'Section 301 List 3',
    rate: 25,
    effectiveFrom: '2019-05-10',
    chapter99Code: '9903.88.03',
  }),
  rateRow('ieepa', {
    authority: 'IEEPA fentanyl',
    rate: 20,
    effectiveFrom: '2025-03-04',
    chapter99Code: '9903.01.24',
  }),
]

const at = (day: string) => new Date(`${day}T12:00:00.000Z`)

describe('resolveTariffRate', () => {
  it('sums the latest row per authority', () => {
    const resolved = resolveTariffRate(CHINESE_VALVE, at('2025-06-01'))

    expect(resolved.status).toBe('resolved')
    expect(resolved.rate).toBe(47)
    expect(resolved.components.map((c) => c.authority)).toEqual([
      'MFN',
      'Section 301 List 3',
      'IEEPA fentanyl',
    ])
  })

  it('ignores rows that have not taken effect yet', () => {
    // The day before the IEEPA action: 2% + 25%, not 47%.
    expect(resolveTariffRate(CHINESE_VALVE, at('2025-03-03')).rate).toBe(27)
  })

  it('includes a row on the very day it takes effect', () => {
    // `<=`, not `<`. A rate that starts March 4 applies ON March 4.
    expect(resolveTariffRate(CHINESE_VALVE, at('2025-03-04')).rate).toBe(47)
  })

  it('takes the latest row within one authority rather than summing them', () => {
    // A 301 rate that moved twice is ONE authority contributing ONE number.
    const rows = [
      rateRow('a', { authority: '301', rate: 10, effectiveFrom: '2019-05-10' }),
      rateRow('b', { authority: '301', rate: 25, effectiveFrom: '2024-01-01' }),
      rateRow('c', { authority: '301', rate: 100, effectiveFrom: '2026-04-01' }),
    ]

    const resolved = resolveTariffRate(rows, at('2025-01-01'))
    expect(resolved.rate).toBe(25)
    expect(resolved.components).toHaveLength(1)
  })

  it('degrades to "the latest row wins" when every authority is blank', () => {
    // The simple blended schedule, which is what people enter first. Same rule,
    // no configuration.
    const rows = [
      rateRow('a', { rate: 10, effectiveFrom: '2024-01-01' }),
      rateRow('b', { rate: 30, effectiveFrom: '2025-02-01' }),
    ]

    const resolved = resolveTariffRate(rows, at('2025-06-01'))
    expect(resolved.rate).toBe(30)
    expect(resolved.components.map((c) => c.id)).toEqual(['b'])
  })

  it('treats a blank authority as its own authority beside named ones', () => {
    const rows = [
      rateRow('base', { rate: 2, effectiveFrom: '2024-01-01' }),
      rateRow('s301', { authority: 'Section 301', rate: 25, effectiveFrom: '2024-01-01' }),
    ]

    expect(resolveTariffRate(rows, at('2025-01-01')).rate).toBe(27)
  })

  it('folds case and surrounding whitespace into one authority', () => {
    // 🛑 Three spellings of MFN summed would TRIPLE a base duty with nothing on
    // screen to show it. They are one authority, and the latest wins.
    const rows = [
      rateRow('a', { authority: 'MFN', rate: 2, effectiveFrom: '2024-01-01' }),
      rateRow('b', { authority: ' mfn ', rate: 3, effectiveFrom: '2025-01-01' }),
    ]

    const resolved = resolveTariffRate(rows, at('2025-06-01'))
    expect(resolved.rate).toBe(3)
    expect(resolved.components).toHaveLength(1)
    expect(resolved.components[0]?.authority).toBe('mfn')
  })

  it('breaks a same-day tie within an authority deterministically, on id', () => {
    // Without this the winner is whatever order the rows arrived in, and a
    // total that changes between renders is unexplainable to a user.
    const rows = [
      rateRow('b', { authority: 'MFN', rate: 5, effectiveFrom: '2025-01-01' }),
      rateRow('a', { authority: 'MFN', rate: 9, effectiveFrom: '2025-01-01' }),
    ]

    expect(resolveTariffRate(rows, at('2025-06-01')).components[0]?.id).toBe('b')
    expect(resolveTariffRate([...rows].reverse(), at('2025-06-01')).components[0]?.id).toBe('b')
  })

  it('orders components oldest first, the way an entry summary reads', () => {
    const resolved = resolveTariffRate([...CHINESE_VALVE].reverse(), at('2025-06-01'))
    expect(resolved.components.map((c) => c.effectiveFrom)).toEqual([
      '1995-01-01',
      '2019-05-10',
      '2025-03-04',
    ])
  })
})

describe('resolveTariffRate: the states a caller must tell apart', () => {
  it('reports "unclassified" for no rows at all, not 0%', () => {
    // 🛑 A domestic part with no duty and an unfinished row both produce 0.
    // They mean opposite things and the UI has to show them differently.
    const resolved = resolveTariffRate([], at('2025-06-01'))
    expect(resolved.status).toBe('unclassified')
    expect(resolved.rate).toBe(0)
    expect(resolved.components).toEqual([])
  })

  it('reports "pending" when every row starts after the lookup date', () => {
    // A code that IS classified but has no rate in force yet - a future-dated
    // action entered ahead of time. Not the same as unclassified.
    const resolved = resolveTariffRate(CHINESE_VALVE, at('1990-01-01'))
    expect(resolved.status).toBe('pending')
    expect(resolved.rate).toBe(0)
  })

  it('reports "resolved" with a real 0, which is an expiry and not an absence', () => {
    // §1.4: a rate that expires back to nothing is an explicit row at 0.
    const rows = [
      rateRow('a', { authority: 'Section 301', rate: 25, effectiveFrom: '2019-05-10' }),
      rateRow('b', { authority: 'Section 301', rate: 0, effectiveFrom: '2026-01-01' }),
    ]

    const resolved = resolveTariffRate(rows, at('2026-06-01'))
    expect(resolved.status).toBe('resolved')
    expect(resolved.rate).toBe(0)
    expect(resolved.components).toHaveLength(1)
  })
})

describe('resolveTariffRate: the breakdown', () => {
  it('carries the chapter 99 code through for display', () => {
    const resolved = resolveTariffRate(CHINESE_VALVE, at('2025-06-01'))
    expect(resolved.components.map((c) => c.chapter99Code)).toEqual([
      null,
      '9903.88.03',
      '9903.01.24',
    ])
  })

  it('never lets the chapter 99 code touch the arithmetic', () => {
    // It is documentation. Adding, changing or removing it moves nothing.
    const withCodes = resolveTariffRate(CHINESE_VALVE, at('2025-06-01')).rate
    const withoutCodes = resolveTariffRate(
      CHINESE_VALVE.map((row) => ({ ...row, chapter99Code: null })),
      at('2025-06-01')
    ).rate

    expect(withCodes).toBe(withoutCodes)
  })

  it('exposes the components a missing base row would otherwise hide', () => {
    // 🛑 §3: a code with a 301 row and no base row resolves to 25% rather than
    // 27%, and nothing about the number looks wrong. Only the breakdown says so.
    const resolved = resolveTariffRate(
      [rateRow('s301', { authority: 'Section 301 List 3', rate: 25 })],
      at('2025-06-01')
    )

    expect(resolved.rate).toBe(25)
    expect(resolved.components.map((c) => c.authority)).toEqual(['Section 301 List 3'])
  })
})

describe('resolveTariffRate: dates', () => {
  it('compares in the timezone it is given, not in UTC', () => {
    // 🛑 A rate that starts on March 2 must not apply to a March 1 evening
    // lookup in Los Angeles. That instant is already March 2 in UTC.
    const rows = [rateRow('a', { rate: 25, effectiveFrom: '2026-03-02' })]
    const marchFirstEvening = new Date('2026-03-02T04:00:00.000Z')

    expect(resolveTariffRate(rows, marchFirstEvening, 'America/Los_Angeles').status).toBe('pending')
    expect(resolveTariffRate(rows, marchFirstEvening, 'UTC').rate).toBe(25)
  })

  it('reads a Date effectiveFrom as a calendar day in UTC', () => {
    // A `FieldType.DATE` value arrives as midnight UTC. Reinterpreting it in a
    // western zone would move every row in the schedule back a day.
    const rows = [rateRow('a', { rate: 25, effectiveFrom: new Date('2026-03-02T00:00:00.000Z') })]

    expect(resolveTariffRate(rows, at('2026-03-02'), 'America/Los_Angeles').rate).toBe(25)
    expect(resolveTariffRate(rows, at('2026-03-01'), 'America/Los_Angeles').status).toBe('pending')
  })

  it('accepts a full ISO timestamp string and reads only its day', () => {
    const rows = [rateRow('a', { rate: 25, effectiveFrom: '2026-03-02T00:00:00.000Z' })]
    expect(resolveTariffRate(rows, at('2026-03-02')).rate).toBe(25)
  })

  it('skips a row with no usable effectiveFrom rather than letting it win', () => {
    // §1.4: the date is required on every row, so an absent one is a broken row
    // and must not shadow the real schedule by counting as "always in force".
    const rows = [
      rateRow('good', { authority: 'MFN', rate: 2, effectiveFrom: '2024-01-01' }),
      rateRow('broken', { authority: 'MFN', rate: 99, effectiveFrom: null }),
      rateRow('garbage', { authority: 'MFN', rate: 99, effectiveFrom: 'soon' }),
    ]

    expect(resolveTariffRate(rows, at('2025-06-01')).rate).toBe(2)
  })

  it('treats a null rate as zero rather than dropping the authority', () => {
    const rows = [rateRow('a', { authority: 'MFN', rate: null, effectiveFrom: '2024-01-01' })]
    const resolved = resolveTariffRate(rows, at('2025-06-01'))

    expect(resolved.status).toBe('resolved')
    expect(resolved.rate).toBe(0)
  })

  it('refuses an invalid lookup date instead of resolving against NaN', () => {
    expect(() => resolveTariffRate(CHINESE_VALVE, new Date('not a date'))).toThrow(BadRequestError)
  })
})
