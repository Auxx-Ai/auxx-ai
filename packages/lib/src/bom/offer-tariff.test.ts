// packages/lib/src/bom/offer-tariff.test.ts
//
// 29 §3.1 as a function (30 §1): override, else schedule, else zero - with the
// three "zero" readings kept apart, because the six callers that share this
// would otherwise each collapse them differently.

import { describe, expect, it } from 'vitest'
import { resolveOfferTariff, type TariffRateRow } from './vendor-cost'

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

const CN_VALVE = 'code_cn'
const SCHEDULE = new Map<string, TariffRateRow[]>([
  [
    CN_VALVE,
    [
      rateRow('mfn', { authority: 'MFN', rate: 2, effectiveFrom: '1995-01-01' }),
      rateRow('s301', {
        authority: 'Section 301 List 3',
        rate: 25,
        effectiveFrom: '2019-05-10',
        chapter99Code: '9903.88.03',
      }),
    ],
  ],
  ['code_future', [rateRow('later', { rate: 10, effectiveFrom: '2030-01-01' })]],
  ['code_empty', []],
])

const at = (day: string) => new Date(`${day}T12:00:00.000Z`)

describe('resolveOfferTariff', () => {
  it('a set override wins and the schedule is not consulted', () => {
    const result = resolveOfferTariff(
      { tariffRate: 12, tariffCodeId: CN_VALVE },
      SCHEDULE,
      at('2025-06-01')
    )
    expect(result).toEqual({ source: 'override', rate: 12 })
  })

  it('an override of 0 is still an override - a DDP price carries no separate duty', () => {
    const result = resolveOfferTariff(
      { tariffRate: 0, tariffCodeId: CN_VALVE },
      SCHEDULE,
      at('2025-06-01')
    )
    expect(result).toEqual({ source: 'override', rate: 0 })
  })

  it('resolves the schedule when the override is blank', () => {
    const result = resolveOfferTariff(
      { tariffRate: null, tariffCodeId: CN_VALVE },
      SCHEDULE,
      at('2025-06-01')
    )
    expect(result.source).toBe('schedule')
    expect(result.rate).toBe(27)
    if (result.source !== 'schedule' || result.status !== 'resolved') throw new Error('shape')
    expect(result.components.map((c) => c.authority)).toEqual(['MFN', 'Section 301 List 3'])
  })

  it('resolves at the date given, not at now', () => {
    const before301 = resolveOfferTariff(
      { tariffRate: null, tariffCodeId: CN_VALVE },
      SCHEDULE,
      at('2019-01-15')
    )
    expect(before301.rate).toBe(2)
  })

  it('keeps the three zero readings apart', () => {
    const none = resolveOfferTariff(
      { tariffRate: null, tariffCodeId: null },
      SCHEDULE,
      at('2025-06-01')
    )
    expect(none).toEqual({ source: 'none', rate: 0 })

    const pending = resolveOfferTariff(
      { tariffRate: null, tariffCodeId: 'code_future' },
      SCHEDULE,
      at('2025-06-01')
    )
    expect(pending).toEqual({ source: 'schedule', status: 'pending', rate: 0, components: [] })

    // A code that exists but has no rows, and a code the map has never heard
    // of, are the same answer: classified, nothing behind it.
    for (const tariffCodeId of ['code_empty', 'code_unknown']) {
      const unclassified = resolveOfferTariff(
        { tariffRate: null, tariffCodeId },
        SCHEDULE,
        at('2025-06-01')
      )
      expect(unclassified).toEqual({
        source: 'schedule',
        status: 'unclassified',
        rate: 0,
        components: [],
      })
    }
  })

  it('threads the timezone through to the day comparison', () => {
    // 2019-05-09T22:00Z is May 10 in Berlin and May 9 in UTC. The 301 row starts
    // May 10, so the zone decides whether it is in force.
    const instant = new Date('2019-05-09T22:00:00.000Z')
    const offer = { tariffRate: null, tariffCodeId: CN_VALVE }
    expect(resolveOfferTariff(offer, SCHEDULE, instant, 'UTC').rate).toBe(2)
    expect(resolveOfferTariff(offer, SCHEDULE, instant, 'Europe/Berlin').rate).toBe(27)
  })
})
