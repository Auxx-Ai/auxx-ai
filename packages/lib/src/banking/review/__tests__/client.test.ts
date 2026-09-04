// packages/lib/src/banking/review/__tests__/client.test.ts
//
// The candidate window and the transfer detector, exhaustively.
//
// 🛑 Both of these are load-bearing in a way a unit test is the only place to
// prove. A wrong candidate window offers a $500 receipt as a match for a $500
// payment and links two unrelated events, leaving both of the real ones
// unreconciled forever. A wrong opposite-leg detector posts a cash-to-cash entry
// between two accounts that never exchanged money - and it balances, so nothing
// downstream can catch it.
//
// Pure, so no database, no doubles, no `vi.mock`.

import { describe, expect, it } from 'vitest'
import {
  bankLineFlow,
  bankTransactionPeriodKey,
  CANDIDATE_DAY_WINDOW,
  isLinkableTransferLeg,
  isOppositeLeg,
  isWithinAmountTolerance,
  isWithinCandidateWindow,
  pickLinkableTransferLeg,
  pickOppositeLeg,
  scoreCandidate,
} from '../client'

const LEG = {
  id: 'a',
  amountMinor: -50_000,
  postedAt: '2026-09-10',
}

function candidate(over: Partial<Parameters<typeof isOppositeLeg>[1]> = {}) {
  return {
    id: 'b',
    amountMinor: 50_000,
    postedAt: '2026-09-10',
    bankStatus: 'posted' as const,
    reviewStatus: 'for_review' as const,
    ...over,
  }
}

describe('bankLineFlow', () => {
  it('reads the sign and nothing else', () => {
    expect(bankLineFlow(-1)).toBe('out')
    expect(bankLineFlow(-100_000)).toBe('out')
    expect(bankLineFlow(1)).toBe('in')
    // Total by fiat: a $0 line is refused by the builder before this is used.
    expect(bankLineFlow(0)).toBe('in')
  })
})

describe('isWithinCandidateWindow', () => {
  it.each([
    ['2026-09-07', true],
    ['2026-09-08', true],
    ['2026-09-10', true],
    ['2026-09-13', true],
    ['2026-09-06', false],
    ['2026-09-14', false],
  ])('%s -> %s at the default window', (key, expected) => {
    expect(isWithinCandidateWindow('2026-09-10', key)).toBe(expected)
  })

  it('is symmetric around the bank date', () => {
    for (let offset = -6; offset <= 6; offset++) {
      const key = new Date(Date.UTC(2026, 8, 10 + offset)).toISOString().slice(0, 10)
      expect(isWithinCandidateWindow('2026-09-10', key)).toBe(
        Math.abs(offset) <= CANDIDATE_DAY_WINDOW
      )
    }
  })

  it('crosses a month boundary, which is the case that matters', () => {
    // A wire raised on the 30th lands on the 1st. A window that stopped at the
    // month edge would never match the commonest real late-clearing payment.
    expect(isWithinCandidateWindow('2026-08-30', '2026-09-01')).toBe(true)
    expect(isWithinCandidateWindow('2026-12-31', '2027-01-02')).toBe(true)
  })

  it('answers false for a candidate with no date at all', () => {
    expect(isWithinCandidateWindow('2026-09-10', null)).toBe(false)
  })

  it('honours a widened window', () => {
    expect(isWithinCandidateWindow('2026-09-10', '2026-09-17', 7)).toBe(true)
    expect(isWithinCandidateWindow('2026-09-10', '2026-09-18', 7)).toBe(false)
  })
})

describe('isWithinAmountTolerance', () => {
  it('accepts an exact match', () => {
    expect(isWithinAmountTolerance(100_000, 100_000)).toBe(true)
  })

  it('accepts one percent either side and refuses beyond it', () => {
    expect(isWithinAmountTolerance(100_000, 99_000)).toBe(true)
    expect(isWithinAmountTolerance(100_000, 101_000)).toBe(true)
    expect(isWithinAmountTolerance(100_000, 98_999)).toBe(false)
    expect(isWithinAmountTolerance(100_000, 101_001)).toBe(false)
  })

  it('rounds the tolerance UP, so a small line is still comparable', () => {
    // 1% of $1.00 is one cent; 1% of $0.50 rounds to one cent rather than zero,
    // or every small line would compare exactly and match nothing.
    expect(isWithinAmountTolerance(100, 101)).toBe(true)
    expect(isWithinAmountTolerance(100, 102)).toBe(false)
    expect(isWithinAmountTolerance(50, 51)).toBe(true)
    expect(isWithinAmountTolerance(50, 52)).toBe(false)
  })

  it('compares absolute values, so a sign never sneaks in', () => {
    expect(isWithinAmountTolerance(-100_000, 100_000)).toBe(true)
    expect(isWithinAmountTolerance(100_000, -100_000)).toBe(true)
  })

  it('refuses a non-finite figure rather than answering true', () => {
    expect(isWithinAmountTolerance(Number.NaN, 100)).toBe(false)
    expect(isWithinAmountTolerance(100, Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('scoreCandidate', () => {
  it('gives an exact amount on the exact day a 1', () => {
    expect(
      scoreCandidate({
        bankAbsMinor: 50_000,
        candidateAbsMinor: 50_000,
        bankDateKey: '2026-09-10',
        candidateDateKey: '2026-09-10',
      })
    ).toBe(1)
  })

  it('weights the amount above the date', () => {
    // An exact amount a day late beats a same-day candidate that is a third
    // out. Two documents on one day is common; two for the same cent is not.
    const exactButLate = scoreCandidate({
      bankAbsMinor: 50_000,
      candidateAbsMinor: 50_000,
      bankDateKey: '2026-09-10',
      candidateDateKey: '2026-09-11',
    })
    const sameDayWayOff = scoreCandidate({
      bankAbsMinor: 50_000,
      candidateAbsMinor: 35_000,
      bankDateKey: '2026-09-10',
      candidateDateKey: '2026-09-10',
    })
    expect(exactButLate).toBeGreaterThan(sameDayWayOff)
  })

  it('falls off with distance on both axes', () => {
    const near = scoreCandidate({
      bankAbsMinor: 50_000,
      candidateAbsMinor: 50_000,
      bankDateKey: '2026-09-10',
      candidateDateKey: '2026-09-11',
    })
    const far = scoreCandidate({
      bankAbsMinor: 50_000,
      candidateAbsMinor: 50_000,
      bankDateKey: '2026-09-10',
      candidateDateKey: '2026-09-13',
    })
    expect(near).toBeGreaterThan(far)
  })

  it('never goes negative, whatever the spread', () => {
    expect(
      scoreCandidate({
        bankAbsMinor: 100,
        candidateAbsMinor: 9_999_999,
        bankDateKey: '2026-09-10',
        candidateDateKey: null,
      })
    ).toBeGreaterThanOrEqual(0)
  })
})

describe('isOppositeLeg', () => {
  it('accepts the exact mirror on the same day', () => {
    expect(isOppositeLeg(LEG, candidate())).toBe(true)
  })

  it('accepts it anywhere inside the window', () => {
    expect(isOppositeLeg(LEG, candidate({ postedAt: '2026-09-07' }))).toBe(true)
    expect(isOppositeLeg(LEG, candidate({ postedAt: '2026-09-13' }))).toBe(true)
  })

  it('refuses it one day outside the window', () => {
    expect(isOppositeLeg(LEG, candidate({ postedAt: '2026-09-06' }))).toBe(false)
    expect(isOppositeLeg(LEG, candidate({ postedAt: '2026-09-14' }))).toBe(false)
  })

  it('refuses the SAME sign - two outflows are not a transfer', () => {
    expect(isOppositeLeg(LEG, candidate({ amountMinor: -50_000 }))).toBe(false)
  })

  it('refuses a near-miss amount, deliberately', () => {
    // Within 1% and still refused: a fee taken in transit makes it two events,
    // and the near-miss belongs in front of a person.
    expect(isOppositeLeg(LEG, candidate({ amountMinor: 49_900 }))).toBe(false)
    expect(isOppositeLeg(LEG, candidate({ amountMinor: 50_100 }))).toBe(false)
  })

  it('refuses a void candidate - the bank withdrew it', () => {
    expect(isOppositeLeg(LEG, candidate({ bankStatus: 'void' }))).toBe(false)
  })

  it('refuses a line somebody has already dealt with', () => {
    for (const reviewStatus of ['matched', 'coded', 'excluded'] as const) {
      expect(isOppositeLeg(LEG, candidate({ reviewStatus }))).toBe(false)
    }
    expect(isOppositeLeg(LEG, candidate({ reviewStatus: 'suggested' }))).toBe(true)
  })

  it('refuses itself', () => {
    expect(isOppositeLeg(LEG, candidate({ id: 'a', amountMinor: 50_000 }))).toBe(false)
  })

  it('refuses when either side has no date', () => {
    expect(isOppositeLeg({ ...LEG, postedAt: null }, candidate())).toBe(false)
    expect(isOppositeLeg(LEG, candidate({ postedAt: null }))).toBe(false)
  })

  it('refuses a zero line, which moved nothing', () => {
    expect(isOppositeLeg({ ...LEG, amountMinor: 0 }, candidate({ amountMinor: 0 }))).toBe(false)
  })

  it('works from the INCOMING side too - the pairing is symmetric', () => {
    const incoming = { id: 'b', amountMinor: 50_000, postedAt: '2026-09-10' }
    expect(isOppositeLeg(incoming, candidate({ id: 'a', amountMinor: -50_000 }))).toBe(true)
  })
})

describe('isLinkableTransferLeg', () => {
  // The stranded FIRST leg: it arrived alone, posted, and was stamped `coded`
  // with the counterpart ACCOUNT because its own opposite had not turned up.
  const LATE = { id: 'late', amountMinor: 250_000, postedAt: '2026-09-10', bankAccountId: 'acct_1' }

  function posted(over: Partial<Parameters<typeof isLinkableTransferLeg>[1]> = {}) {
    return {
      id: 'first',
      amountMinor: -250_000,
      postedAt: '2026-09-09',
      bankStatus: 'posted' as const,
      reviewStatus: 'coded' as const,
      matchedRecordId: 'acct_1',
      matchedRecordType: 'bank_account' as const,
      glPostingId: 'post_first',
      ...over,
    }
  }

  it('🛑 recognises the leg that already posted this movement', () => {
    // Without this the late leg posts a SECOND cash-to-cash entry for one
    // movement, both entries balance, and nothing downstream detects it.
    expect(isLinkableTransferLeg(LATE, posted())).toBe(true)
  })

  it('refuses a coded line stamped with a DIFFERENT account', () => {
    expect(isLinkableTransferLeg(LATE, posted({ matchedRecordId: 'acct_9' }))).toBe(false)
  })

  it('refuses a coded line that carries no posting - there is nothing to link to', () => {
    expect(isLinkableTransferLeg(LATE, posted({ glPostingId: null }))).toBe(false)
  })

  it('refuses a line matched to a DOCUMENT rather than left pointing at an account', () => {
    expect(isLinkableTransferLeg(LATE, posted({ matchedRecordType: 'vendor_payment' }))).toBe(false)
  })

  it('refuses a line nobody coded, which the ordinary detector handles', () => {
    expect(isLinkableTransferLeg(LATE, posted({ reviewStatus: 'for_review' }))).toBe(false)
  })

  it('refuses the same sign, a void line, itself, and anything outside the window', () => {
    expect(isLinkableTransferLeg(LATE, posted({ amountMinor: 250_000 }))).toBe(false)
    expect(isLinkableTransferLeg(LATE, posted({ bankStatus: 'void' }))).toBe(false)
    expect(isLinkableTransferLeg(LATE, posted({ id: 'late' }))).toBe(false)
    expect(isLinkableTransferLeg(LATE, posted({ postedAt: '2026-09-01' }))).toBe(false)
  })

  it('refuses when the late leg has no date or no account', () => {
    expect(isLinkableTransferLeg({ ...LATE, postedAt: null }, posted())).toBe(false)
    expect(isLinkableTransferLeg({ ...LATE, bankAccountId: null }, posted())).toBe(false)
  })

  it('picks the closest date, then the smallest id', () => {
    const near = posted({ id: 'near', postedAt: '2026-09-10' })
    const far = posted({ id: 'far', postedAt: '2026-09-12' })
    expect(pickLinkableTransferLeg(LATE, [far, near])?.id).toBe('near')
    expect(pickLinkableTransferLeg(LATE, [])).toBeNull()
  })
})

describe('pickOppositeLeg', () => {
  it('answers null when nothing qualifies', () => {
    expect(pickOppositeLeg(LEG, [candidate({ amountMinor: 40_000 })])).toBeNull()
    expect(pickOppositeLeg(LEG, [])).toBeNull()
  })

  it('prefers the closest date', () => {
    const near = candidate({ id: 'near', postedAt: '2026-09-11' })
    const far = candidate({ id: 'far', postedAt: '2026-09-13' })
    expect(pickOppositeLeg(LEG, [far, near])?.id).toBe('near')
  })

  it('breaks a same-day tie on the id, so the answer is stable', () => {
    const first = candidate({ id: 'aaa' })
    const second = candidate({ id: 'zzz' })
    expect(pickOppositeLeg(LEG, [second, first])?.id).toBe('aaa')
    expect(pickOppositeLeg(LEG, [first, second])?.id).toBe('aaa')
  })

  it('skips a disqualified nearer leg for a qualifying farther one', () => {
    const nearButVoid = candidate({ id: 'near', postedAt: '2026-09-10', bankStatus: 'void' })
    const far = candidate({ id: 'far', postedAt: '2026-09-13' })
    expect(pickOppositeLeg(LEG, [nearButVoid, far])?.id).toBe('far')
  })
})

describe('bankTransactionPeriodKey', () => {
  it('carries a short external id through, so the ledger and the statement share a string', () => {
    const key = bankTransactionPeriodKey({
      transactionId: 'x',
      externalId: 'ch-1042',
      bankAccountId: 'acct_1',
    })
    expect(key.startsWith('CH1042')).toBe(true)
    expect(key).toMatch(/^CH1042[0-9A-Z]{3}$/)
  })

  it('🛑 account-scopes the external id: a FITID is unique per ACCOUNT, not per bank', () => {
    // Two accounts at one institution sharing a FITID would otherwise mint one
    // period tuple, the second `postEntry` would answer `already_posted` - a
    // SUCCESS - and the second line would be stamped with the FIRST line's
    // posting id: one entry for two transactions, and it balances.
    const first = bankTransactionPeriodKey({
      transactionId: 'row_a',
      externalId: 'ch-1042',
      bankAccountId: 'acct_1',
    })
    const second = bankTransactionPeriodKey({
      transactionId: 'row_b',
      externalId: 'ch-1042',
      bankAccountId: 'acct_2',
    })
    expect(first).not.toBe(second)
  })

  it('skips the external-id shortcut entirely when no account is known', () => {
    const key = bankTransactionPeriodKey({ transactionId: 'x', externalId: 'ch-1042' })
    expect(key).toMatch(/^BNK-[0-9A-Z]{6}$/)
  })

  it('mints a hash when the external id is over the scoped budget', () => {
    const key = bankTransactionPeriodKey({
      transactionId: 'x',
      externalId: 'bt-demo-001',
      bankAccountId: 'acct_1',
    })
    expect(key).toMatch(/^BNK-[0-9A-Z]{6}$/)
  })

  it('mints a hash when the external id carries a character the doc number cannot strip', () => {
    // `buildDocNumber` strips hyphens and nothing else, so an underscore would
    // reach the document number verbatim.
    const key = bankTransactionPeriodKey({
      transactionId: 'x',
      externalId: 'fctxn_1LXp9RGxLVUXRs6HtTSVfxse',
      bankAccountId: 'acct_1',
    })
    expect(key).toMatch(/^BNK-[0-9A-Z]{6}$/)
  })

  it('is deterministic and differs per row', () => {
    const a = bankTransactionPeriodKey({ transactionId: 'row_one' })
    expect(bankTransactionPeriodKey({ transactionId: 'row_one' })).toBe(a)
    expect(bankTransactionPeriodKey({ transactionId: 'row_two' })).not.toBe(a)
  })

  it('always compacts inside the nine-character budget the doc number leaves', () => {
    for (let index = 0; index < 500; index++) {
      const key = bankTransactionPeriodKey({ transactionId: `cuid_${index}` })
      expect(key.replace(/-/g, '').length).toBeLessThanOrEqual(9)
      const scoped = bankTransactionPeriodKey({
        transactionId: `cuid_${index}`,
        externalId: `t${index}`,
        bankAccountId: `acct_${index}`,
      })
      expect(scoped.replace(/-/g, '').length).toBeLessThanOrEqual(9)
    }
  })

  it('refuses a blank row id rather than minting a colliding key', () => {
    expect(() => bankTransactionPeriodKey({ transactionId: '  ' })).toThrow()
  })

  describe('the retry attempt', () => {
    it('🛑 mints a DIFFERENT key on every attempt', () => {
      // Without this a line can be coded exactly once, ever: a re-code after an
      // undo re-claims the tuple the reversed original still holds, `postEntry`
      // answers `already_posted` - a SUCCESS - and the line ends up reading
      // `coded` while pointing at an entry that has been backed out.
      const keys = new Set<string>()
      for (let attempt = 0; attempt <= 35; attempt++) {
        keys.add(bankTransactionPeriodKey({ transactionId: 'row_one', attempt }))
      }
      expect(keys.size).toBe(36)
    })

    it('ignores a short external id once the line is being retried', () => {
      const first = bankTransactionPeriodKey({
        transactionId: 'x',
        externalId: 'ch-1042',
        bankAccountId: 'acct_1',
      })
      const retry = bankTransactionPeriodKey({
        transactionId: 'x',
        externalId: 'ch-1042',
        bankAccountId: 'acct_1',
        attempt: 2,
      })
      expect(first).toMatch(/^CH1042[0-9A-Z]{3}$/)
      expect(retry).not.toBe(first)
      expect(retry).toMatch(/^BNK-[0-9A-Z]{5}2$/)
    })

    it('keeps every attempt inside the nine-character budget', () => {
      for (let attempt = 0; attempt <= 35; attempt++) {
        const key = bankTransactionPeriodKey({ transactionId: 'row_one', attempt })
        expect(key.replace(/-/g, '').length).toBeLessThanOrEqual(9)
      }
    })

    it('is deterministic per attempt', () => {
      expect(bankTransactionPeriodKey({ transactionId: 'row_one', attempt: 4 })).toBe(
        bankTransactionPeriodKey({ transactionId: 'row_one', attempt: 4 })
      )
    })

    it('refuses beyond the keyspace rather than colliding, naming the remedy', () => {
      expect(() => bankTransactionPeriodKey({ transactionId: 'row_one', attempt: 36 })).toThrow(
        /manual journal entry/
      )
      expect(() => bankTransactionPeriodKey({ transactionId: 'row_one', attempt: -1 })).toThrow()
    })
  })
})
