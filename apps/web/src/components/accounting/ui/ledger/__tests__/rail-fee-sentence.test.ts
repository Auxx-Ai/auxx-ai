// apps/web/src/components/accounting/ui/ledger/__tests__/rail-fee-sentence.test.ts
//
// The Processor fees copy (brief 26 §6).
//
// 🛑 What this file is really pinning is a NEGATIVE: no sentence here is an
// alarm, none of them names a remedy, and the `shared` case never quotes a
// date. §14's R4 - a rail that bills quarterly must not nag - and §5 - a date
// read off the shared fallback account belongs to every other rail too.

import type { RailFeeStatus } from '@auxx/lib/postings/client'
import { describe, expect, it } from 'vitest'
import { formatMonthsAgo, railFeeSentence, railTradeNote } from '../format'

const TZ = 'UTC'
const MONTH = '2026-09'

function rail(overrides: Partial<RailFeeStatus> = {}): RailFeeStatus {
  return {
    paymentGatewayId: 'pg_1',
    name: 'Authorize.net',
    feeTreatment: 'billed',
    tradedInMonth: true,
    fees: { kind: 'own', glAccountId: 'gl_6150', bookedInMonth: false, lastBookedAt: '2026-07-14' },
    ...overrides,
  }
}

describe('formatMonthsAgo', () => {
  it('counts whole months back from the month on screen', () => {
    expect(formatMonthsAgo('2026-07-14', '2026-09')).toBe('2 months ago')
  })

  it('reads one month back as "last month"', () => {
    expect(formatMonthsAgo('2026-08-31', '2026-09')).toBe('last month')
  })

  it('crosses a year boundary', () => {
    expect(formatMonthsAgo('2025-11-02', '2026-02')).toBe('3 months ago')
  })

  // "0 months ago" is noise the reader has to decode, and a future date has no
  // "ago" to state at all.
  it('says nothing for a date inside the month on screen or after it', () => {
    expect(formatMonthsAgo('2026-09-03', '2026-09')).toBeNull()
    expect(formatMonthsAgo('2026-10-03', '2026-09')).toBeNull()
  })

  it('says nothing for a malformed key rather than guessing', () => {
    expect(formatMonthsAgo('not-a-date', '2026-09')).toBeNull()
    expect(formatMonthsAgo('2026-07-14', 'whenever')).toBeNull()
  })
})

describe('railFeeSentence', () => {
  it('says a netted rail is booked with each payout', () => {
    expect(railFeeSentence(rail({ feeTreatment: 'netted' }), MONTH, TZ)).toBe(
      'Netted, booked with each payout.'
    )
  })

  it('gives a billed rail its date and how long ago it was', () => {
    expect(railFeeSentence(rail(), MONTH, TZ)).toBe(
      'Billed separately. Last fee booked Jul 14, 2026 (2 months ago). Nothing in September 2026.'
    )
  })

  it('names the month when a fee did land in it', () => {
    const sentence = railFeeSentence(
      rail({
        fees: {
          kind: 'own',
          glAccountId: 'gl_6150',
          bookedInMonth: true,
          lastBookedAt: '2026-09-11',
        },
      }),
      MONTH,
      TZ
    )
    expect(sentence).toBe('Billed separately. Last fee booked Sep 11, 2026, in September 2026.')
  })

  // `never` is legible on its own - §6's whole argument for not building a nag.
  it('says a fee has never been booked, without a remedy', () => {
    const sentence = railFeeSentence(
      rail({
        fees: { kind: 'own', glAccountId: 'gl_6150', bookedInMonth: false, lastBookedAt: null },
      }),
      MONTH,
      TZ
    )
    expect(sentence).toBe('Billed separately. No fee has ever been booked to its own account.')
  })

  // 🔑 §5. A date here would belong to every netted rail's fallback as well.
  it('quotes no date at all for a rail sharing the default fee account', () => {
    const sentence = railFeeSentence(rail({ fees: { kind: 'shared' } }), MONTH, TZ)
    expect(sentence).toContain('default fee account')
    expect(sentence).not.toMatch(/\d{4}/)
  })

  it('fails closed on a treatment it does not know', () => {
    const unknown = rail({ feeTreatment: 'deferred' as RailFeeStatus['feeTreatment'] })
    expect(railFeeSentence(unknown, MONTH, TZ)).toBe(
      'Its fee treatment is not set, so nothing here can be said about its fees.'
    )
  })

  it('fails closed on an account shape it does not know', () => {
    const unknown = rail({ fees: { kind: 'elsewhere' } as unknown as RailFeeStatus['fees'] })
    expect(railFeeSentence(unknown, MONTH, TZ)).toBe(
      'Billed separately. Where its fees are booked could not be read.'
    )
  })

  // No checkmark, no red, no "action required", and above all no refusal.
  it('never names an action', () => {
    const sentences = [
      railFeeSentence(rail({ feeTreatment: 'netted' }), MONTH, TZ),
      railFeeSentence(rail(), MONTH, TZ),
      railFeeSentence(rail({ fees: { kind: 'shared' } }), MONTH, TZ),
    ]
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/action required|must|before closing|fix|blocked/i)
    }
  })
})

describe('railTradeNote', () => {
  it('softens a billed rail that did not trade in the month', () => {
    expect(railTradeNote(rail({ tradedInMonth: false }), MONTH)).toBe(
      'Nothing posted to its clearing account in September 2026.'
    )
  })

  it('says nothing for a rail that traded', () => {
    expect(railTradeNote(rail(), MONTH)).toBeNull()
  })

  it('says nothing for a netted rail either way', () => {
    expect(railTradeNote(rail({ feeTreatment: 'netted', tradedInMonth: false }), MONTH)).toBeNull()
  })
})
