// packages/lib/src/postings/__tests__/build-credit-memo-batch-entry.test.ts
//
// The batch builder turns a month of credit memos into ONE posting, so what can
// go wrong here is not the arithmetic - `computeCreditMemoAmounts` owns that and
// the single-memo suite covers it. It is the three things that must not
// summarise away (brief 25 §3.1), each of which produces an entry that still
// BALANCES and that nothing downstream can detect:
//
//  1. **The settlement credit stays per resolved account id.** An Affirm memo
//     and a card memo in one group must stay two credit lines, or `1210` is
//     overstated forever.
//  2. **The A/R leg stays per counterparty.** Aging has to name the debtor, and
//     for an all-channel group it is usually zero lines.
//  3. **`reverseRevenue: false` members contribute a money leg only**, in the
//     SAME group - their contra-revenue and tax are omitted and their
//     settlement survives, which lands their share of A/R on the debit side.
//
// Plus the keyspace: a month key claims its month once, and a memo issued late
// into a posted month needs the attempt suffix.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import type {
  CreditMemoAmounts,
  CreditMemoPostingGroup,
  PlannedCreditMemo,
} from '../../money/credit-memo-posting/types'
import { CREDIT_MEMO_BATCH_SOURCE_TYPE } from '../../money/credit-memo-posting/types'
import {
  buildCreditMemoBatchEntry,
  CREDIT_MEMO_CONTACT_SOURCE_TYPE,
  type CreditMemoBatchSource,
  creditMemoBatchPeriodKey,
  MAX_COMPACT_CREDIT_MEMO_BATCH_KEY,
  MAX_CREDIT_MEMO_BATCH_ATTEMPT,
} from '../build-credit-memo-batch-entry'
import {
  buildCreditMemoEntry,
  CREDIT_MEMO_POSTING_TYPE,
  computeCreditMemoAmounts,
} from '../build-credit-memo-entry'
import { ACCOUNT_ROLES } from '../build-entry'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH } from '../doc-number'
import type { GlPostingLineInput } from '../types'

// ── Fixtures ────────────────────────────────────────────────────────────────

let nextMemo = 0

/**
 * One planned memo, its amounts computed by the SHARED helper rather than typed
 * out - a fixture that hand-wrote them would be testing a second arithmetic.
 */
function memo(
  overrides: Partial<PlannedCreditMemo> & {
    subtotal?: number
    taxTotal?: number
    settlement?: { amount: number; glAccountId?: string }
  } = {}
): PlannedCreditMemo {
  nextMemo += 1
  const creditMemoId = overrides.creditMemoId ?? `cm-${nextMemo}`
  const number = overrides.number ?? `CM-${String(1000 + nextMemo)}`
  const reverseRevenue = overrides.reverseRevenue ?? true
  const subtotal = overrides.subtotal ?? 10_000
  const taxTotal = overrides.taxTotal ?? 800
  const settlement = overrides.settlement
  const amounts =
    overrides.amounts ??
    computeCreditMemoAmounts({
      creditMemoId,
      number,
      subtotal,
      taxTotal,
      total: subtotal + taxTotal,
      reverseRevenue,
      settlement: settlement
        ? settlement.glAccountId
          ? { amount: settlement.amount, glAccountId: settlement.glAccountId }
          : { amount: settlement.amount, role: 'clearing_card' }
        : undefined,
    })
  return {
    creditMemoId,
    number,
    issuedAt: overrides.issuedAt ?? '2026-01-14',
    status: overrides.status ?? 'issued',
    source: overrides.source ?? 'channel',
    currency: overrides.currency ?? 'USD',
    subtotalMinor: subtotal,
    taxTotalMinor: taxTotal,
    totalMinor: subtotal + taxTotal,
    amountRefundedMinor: settlement?.amount ?? 0,
    contactId: overrides.contactId ?? null,
    orderId: overrides.orderId ?? null,
    reverseRevenue,
    amounts,
  }
}

function group(memos: PlannedCreditMemo[], groupKey = '2026-01'): CreditMemoPostingGroup {
  const totals = memos.reduce(
    (acc, row) => ({
      subtotalMinor: acc.subtotalMinor + row.amounts.subtotalMinor,
      taxTotalMinor: acc.taxTotalMinor + row.amounts.taxTotalMinor,
      totalMinor: acc.totalMinor + row.amounts.totalMinor,
      settlementMinor: acc.settlementMinor + row.amounts.settlementMinor,
      receivableMinor: 0,
    }),
    { subtotalMinor: 0, taxTotalMinor: 0, totalMinor: 0, settlementMinor: 0, receivableMinor: 0 }
  )
  return {
    groupKey,
    txnDate: memos.reduce((latest, row) => (row.issuedAt > latest ? row.issuedAt : latest), '0000'),
    memos,
    contactCount: new Set(memos.map((row) => row.contactId).filter(Boolean)).size,
    totals: { ...totals, receivableMinor: totals.totalMinor - totals.settlementMinor },
  }
}

function build(memos: PlannedCreditMemo[], attempt = 0) {
  return buildCreditMemoBatchEntry({ group: group(memos), ledgerCurrency: 'USD', attempt })
}

function byRole(lines: GlPostingLineInput[], role: string) {
  return lines.filter((line) => line.accountRole === role)
}

function expectRefusal(fn: () => unknown): UnprocessableEntityError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    return error as UnprocessableEntityError
  }
  throw new Error('Expected a refusal, got a built entry')
}

/** The property every case in this file asserts, whatever else it is checking. */
function expectBalanced(entry: { totalDebit: number; totalCredit: number }): void {
  expect(entry.totalDebit).toBe(entry.totalCredit)
}

// ── 1. The settlement credit stays per resolved account id (§3.1 item 1) ────

describe('a mixed-gateway group', () => {
  // The Affirm memo settles into the gateway record's OWN clearing account;
  // the card memo settles into the `clearing_card` role. One group.
  const card = memo({ number: 'CM-0001', settlement: { amount: 10_800 } })
  const affirm = memo({
    number: 'CM-0002',
    subtotal: 20_000,
    taxTotal: 1_600,
    settlement: { amount: 21_600, glAccountId: 'gl-affirm' },
  })
  const built = build([card, affirm])

  it('balances', () => {
    expectBalanced(built.entry)
    expect(built.entry.totalDebit).toBe(32_400)
  })

  it('keeps TWO settlement credit lines, one per resolved account', () => {
    // 🛑 The whole point. Collapsed into one `clearing_card` credit this entry
    // still balances and `1210` is overstated forever with nothing to detect it.
    const roleLines = byRole(built.entry.lines, ACCOUNT_ROLES.CLEARING_CARD)
    const idLines = built.entry.lines.filter((line) => line.glAccountId === 'gl-affirm')
    expect(roleLines).toHaveLength(1)
    expect(roleLines[0]).toMatchObject({ direction: 'credit', amount: 10_800 })
    expect(idLines).toHaveLength(1)
    expect(idLines[0]).toMatchObject({ direction: 'credit', amount: 21_600 })
  })

  it('names an account by ID or by ROLE, never both on one line', () => {
    for (const line of built.entry.lines) {
      const names = [line.accountRole, line.accountCode, line.glAccountId].filter(Boolean)
      expect(names).toHaveLength(1)
    }
  })

  it('still summarises the contra-revenue and the tax into one line each', () => {
    const revenue = byRole(built.entry.lines, ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES)
    const tax = byRole(built.entry.lines, ACCOUNT_ROLES.SALES_TAX_PAYABLE)
    expect(revenue).toHaveLength(1)
    expect(revenue[0]).toMatchObject({ direction: 'debit', amount: 30_000 })
    expect(tax).toHaveLength(1)
    expect(tax[0]).toMatchObject({ direction: 'debit', amount: 2_400 })
  })

  it('sums two memos on the same gateway account into ONE line', () => {
    const second = memo({
      number: 'CM-0003',
      subtotal: 5_000,
      taxTotal: 0,
      settlement: { amount: 5_000, glAccountId: 'gl-affirm' },
    })
    const mixed = build([card, affirm, second])
    const idLines = mixed.entry.lines.filter((line) => line.glAccountId === 'gl-affirm')
    expect(idLines).toHaveLength(1)
    expect(idLines[0]?.amount).toBe(26_600)
    expectBalanced(mixed.entry)
  })

  it('summarises every non-receivable line under the batch source and the period key', () => {
    for (const line of built.entry.lines) {
      expect(line.sourceType).toBe(CREDIT_MEMO_BATCH_SOURCE_TYPE)
      expect(line.sourceId).toBe('2026-01')
    }
    expect(CREDIT_MEMO_BATCH_SOURCE_TYPE).toBe('credit_memo_batch')
  })

  it('is the credit_memo posting type, so a January batch mints AUXX-CRM-202601', () => {
    expect(built.entry.postingType).toBe(CREDIT_MEMO_POSTING_TYPE)
    expect(buildDocNumber({ postingType: 'credit_memo', periodKey: built.periodKey })).toBe(
      'AUXX-CRM-202601'
    )
  })

  it('dates the entry on the group, never on a memo', () => {
    expect(built.entry.txnDate).toBe('2026-01-14')
  })

  it('recomputes its totals from the memos actually posted', () => {
    expect(built.totals).toEqual({
      subtotalMinor: 30_000,
      taxTotalMinor: 2_400,
      totalMinor: 32_400,
      settlementMinor: 32_400,
      receivableMinor: 0,
    })
  })
})

// ── 2. The A/R leg stays per counterparty (§3.1 item 2) ─────────────────────

describe('the receivable leg', () => {
  it('is ZERO LINES for an all-channel group, because the money already went back', () => {
    const built = build([
      memo({ contactId: 'contact-a', settlement: { amount: 10_800 } }),
      memo({ contactId: 'contact-b', settlement: { amount: 10_800 } }),
    ])
    expect(byRole(built.entry.lines, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)).toHaveLength(0)
    expectBalanced(built.entry)
  })

  it('is ONE LINE PER CONTACT, counterparty frozen on, for native memos', () => {
    const built = build([
      memo({ number: 'CM-N1', contactId: 'contact-a', source: 'native' }),
      memo({ number: 'CM-N2', contactId: 'contact-b', source: 'native' }),
      memo({
        number: 'CM-N3',
        contactId: 'contact-a',
        source: 'native',
        subtotal: 500,
        taxTotal: 0,
      }),
    ])
    const receivable = byRole(built.entry.lines, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)
    expect(receivable).toHaveLength(2)
    expect(receivable[0]).toMatchObject({
      direction: 'credit',
      // Both of contact A's memos, on one line.
      amount: 11_300,
      sourceType: CREDIT_MEMO_CONTACT_SOURCE_TYPE,
      sourceId: 'contact-a',
      counterpartyType: 'customer',
      counterpartyId: 'contact-a',
    })
    expect(receivable[1]).toMatchObject({ amount: 10_800, counterpartyId: 'contact-b' })
    expectBalanced(built.entry)
    expect(CREDIT_MEMO_CONTACT_SOURCE_TYPE).toBe('contact')
  })

  it('carries the unsettled remainder only, when a memo was partly refunded', () => {
    const built = build([memo({ contactId: 'contact-a', settlement: { amount: 4_000 } })])
    const [receivable] = byRole(built.entry.lines, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)
    expect(receivable).toMatchObject({ direction: 'credit', amount: 6_800 })
    expect(byRole(built.entry.lines, ACCOUNT_ROLES.CLEARING_CARD)[0]?.amount).toBe(4_000)
    expectBalanced(built.entry)
  })

  it('falls open to one undimensioned line for a memo with no contact', () => {
    // The single-memo builder posts an uncounterpartied receivable rather than
    // refusing, and a batch must not be stricter than the document it summarises.
    const built = build([memo({ contactId: null, source: 'native' })])
    const [receivable] = byRole(built.entry.lines, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)
    expect(receivable).toMatchObject({
      direction: 'credit',
      amount: 10_800,
      sourceType: CREDIT_MEMO_BATCH_SOURCE_TYPE,
      sourceId: '2026-01',
    })
    expect(receivable?.counterpartyId).toBeUndefined()
    expectBalanced(built.entry)
  })
})

// ── 3. `reverseRevenue: false` contributes a money leg only (§3.1 item 3) ───

describe('a reverseRevenue: false member mixed with true ones', () => {
  // The CM-0091 case: a channel memo whose order never shipped before it was
  // issued. Its revenue was never recognised, so there is nothing to reverse.
  const shipped = memo({
    number: 'CM-0090',
    contactId: 'contact-a',
    settlement: { amount: 10_800 },
  })
  const neverShipped = memo({
    number: 'CM-0091',
    contactId: 'contact-b',
    reverseRevenue: false,
    subtotal: 7_000,
    taxTotal: 560,
    settlement: { amount: 7_560 },
  })
  const built = build([shipped, neverShipped])

  it('is ONE group, not two', () => {
    expect(built.entry.sources).toHaveLength(2)
    expect(built.periodKey).toBe('2026-01')
  })

  it('omits its subtotal and tax from the contra-revenue and tax totals', () => {
    expect(byRole(built.entry.lines, ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES)[0]?.amount).toBe(
      10_000
    )
    expect(byRole(built.entry.lines, ACCOUNT_ROLES.SALES_TAX_PAYABLE)[0]?.amount).toBe(800)
    expect(built.totals.subtotalMinor).toBe(10_000)
    expect(built.totals.taxTotalMinor).toBe(800)
  })

  it('keeps its settlement credit', () => {
    expect(byRole(built.entry.lines, ACCOUNT_ROLES.CLEARING_CARD)[0]?.amount).toBe(18_360)
    expect(built.totals.settlementMinor).toBe(18_360)
  })

  it('lands its share of A/R on the DEBIT side, exactly as the single-memo money leg does', () => {
    const receivable = byRole(built.entry.lines, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)
    expect(receivable).toHaveLength(1)
    expect(receivable[0]).toMatchObject({
      direction: 'debit',
      amount: 7_560,
      counterpartyId: 'contact-b',
    })

    // The same memo through the single-memo builder: `Dr accounts_receivable /
    // Cr clearing_card`, and the batch has to agree with it.
    const single = buildCreditMemoEntry({
      creditMemoId: neverShipped.creditMemoId,
      number: neverShipped.number,
      issuedAt: neverShipped.issuedAt,
      currency: 'USD',
      subtotal: 7_000,
      taxTotal: 560,
      total: 7_560,
      reverseRevenue: false,
      settlement: { role: 'clearing_card', amount: 7_560 },
      contactInstanceId: 'contact-b',
    })
    const singleReceivable = single.entry.lines.filter(
      (line) => line.accountRole === ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE
    )
    expect(singleReceivable).toHaveLength(1)
    expect(singleReceivable[0]).toMatchObject({ direction: 'debit', amount: 7_560 })
  })

  it('balances', () => {
    expectBalanced(built.entry)
    // Dr 10,000 revenue + 800 tax + 7,560 receivable = Cr 18,360 clearing.
    expect(built.entry.totalDebit).toBe(18_360)
  })

  it('nets a contact who has both kinds of memo down to one line', () => {
    const mixed = build([
      memo({ number: 'CM-A', contactId: 'contact-x', source: 'native' }),
      memo({
        number: 'CM-B',
        contactId: 'contact-x',
        reverseRevenue: false,
        subtotal: 3_000,
        taxTotal: 0,
        settlement: { amount: 3_000 },
      }),
    ])
    const receivable = byRole(mixed.entry.lines, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)
    expect(receivable).toHaveLength(1)
    expect(receivable[0]).toMatchObject({ direction: 'credit', amount: 7_800 })
    expectBalanced(mixed.entry)
  })

  it('refuses a hand-built amounts that reverses no revenue but carries some', () => {
    const bad = memo({
      number: 'CM-BAD',
      reverseRevenue: false,
      settlement: { amount: 3_000 },
    })
    bad.amounts = { ...bad.amounts, subtotalMinor: 10_000, totalMinor: 10_000 } as CreditMemoAmounts
    expect(expectRefusal(() => build([bad])).message).toMatch(/reverses no revenue but carries/)
  })
})

// ── Balance, exhaustively, on a group that mixes everything ─────────────────

describe('a group that mixes every shape at once', () => {
  const built = build([
    // Fully refunded card memo, no contact.
    memo({ number: 'CM-1', settlement: { amount: 10_800 } }),
    // Fully refunded Affirm memo.
    memo({ number: 'CM-2', contactId: 'c1', settlement: { amount: 10_800, glAccountId: 'gl-af' } }),
    // Native memo, nothing refunded.
    memo({ number: 'CM-3', contactId: 'c2', source: 'native' }),
    // Partly refunded.
    memo({ number: 'CM-4', contactId: 'c2', settlement: { amount: 3_000 } }),
    // Never shipped: money leg only.
    memo({
      number: 'CM-5',
      contactId: 'c3',
      reverseRevenue: false,
      subtotal: 2_000,
      taxTotal: 0,
      settlement: { amount: 2_000 },
    }),
    // Tax-free memo.
    memo({ number: 'CM-6', contactId: 'c3', source: 'native', taxTotal: 0 }),
  ])

  it('balances', () => {
    expectBalanced(built.entry)
  })

  it('re-derives receivableMinor as total less settlement over the whole group', () => {
    expect(built.totals.receivableMinor).toBe(
      built.totals.totalMinor - built.totals.settlementMinor
    )
    expect(built.totals.totalMinor).toBe(built.totals.subtotalMinor + built.totals.taxTotalMinor)
  })

  it('numbers its lines from zero with no gaps', () => {
    expect(built.entry.lines.map((line) => line.sortOrder)).toEqual(
      built.entry.lines.map((_, index) => index)
    )
  })

  it('posts no zero legs', () => {
    for (const line of built.entry.lines) expect(line.amount).toBeGreaterThan(0)
  })
})

// ── `sources`: the audit record, written and never read (§2.1) ──────────────

describe('BuiltEntry.sources', () => {
  it('freezes every member onto the entry', () => {
    // ⚠️ An AUDIT RECORD only. Nothing in product code reads it back, and §2.1
    // is explicit that no feature may be designed on top of it - in particular
    // it is NOT the input to a per-member compensating entry.
    const a = memo({ number: 'CM-S1', settlement: { amount: 10_800 } })
    const b = memo({ number: 'CM-S2', contactId: 'c1', source: 'native' })
    const built = build([a, b])
    expect(built.entry.sources).toEqual([
      { creditMemoId: a.creditMemoId, number: 'CM-S1', amounts: a.amounts },
      { creditMemoId: b.creditMemoId, number: 'CM-S2', amounts: b.amounts },
    ] satisfies CreditMemoBatchSource[])
  })
})

// ── Group-level refusals ────────────────────────────────────────────────────

describe('what the builder refuses', () => {
  it('refuses an empty group rather than claiming the period', () => {
    expect(expectRefusal(() => build([])).message).toMatch(/holds no credit memos/)
  })

  it('refuses a memo in a foreign currency rather than posting at an implied 1.0', () => {
    const foreign = memo({ number: 'CM-EUR', currency: 'EUR', source: 'native' })
    expect(expectRefusal(() => build([foreign])).message).toMatch(/implied 1\.0 rate/)
  })

  it('reads a blank currency as the ledger currency', () => {
    const blank = memo({ number: 'CM-BLANK', currency: null, source: 'native' })
    expectBalanced(build([blank]).entry)
  })

  it('refuses a frozen amount that is not whole minor units', () => {
    const fractional = memo({ number: 'CM-FRAC', source: 'native' })
    fractional.amounts = { ...fractional.amounts, settlementMinor: 10.5 }
    expect(expectRefusal(() => build([fractional])).message).toMatch(/not a whole number of cents/)
  })

  it('refuses an amounts whose parts do not sum to its own total', () => {
    const drifted = memo({ number: 'CM-DRIFT', source: 'native' })
    drifted.amounts = { ...drifted.amounts, taxTotalMinor: 900 }
    expect(expectRefusal(() => build([drifted])).message).toMatch(/could not balance/)
  })

  it('refuses a negative settlement', () => {
    const negative = memo({ number: 'CM-NEG', source: 'native' })
    negative.amounts = { ...negative.amounts, settlementMinor: -100 }
    expect(expectRefusal(() => build([negative])).message).toMatch(/never negative/)
  })
})

// ── The keyspace ────────────────────────────────────────────────────────────

describe('creditMemoBatchPeriodKey', () => {
  it('is the group key verbatim at attempt 0', () => {
    // 🛑 Byte for byte: the key is half the claim's uniqueness tuple, so
    // re-keying it would hide every posting already in a ledger.
    expect(creditMemoBatchPeriodKey('2026-01', 0)).toBe('2026-01')
    expect(creditMemoBatchPeriodKey('2026-01-14', 0)).toBe('2026-01-14')
  })

  it('appends one base-36 uppercase character per attempt', () => {
    expect(creditMemoBatchPeriodKey('2026-01-14', 1)).toBe('2026-01-141')
    expect(creditMemoBatchPeriodKey('2026-01-14', 10)).toBe('2026-01-14A')
    expect(creditMemoBatchPeriodKey('2026-01-14', 35)).toBe('2026-01-14Z')
    expect(creditMemoBatchPeriodKey('2026-01', 35)).toBe('2026-01Z')
  })

  it('trims the group key', () => {
    expect(creditMemoBatchPeriodKey('  2026-01  ', 0)).toBe('2026-01')
  })

  it('leaves exactly one character of budget for the attempt', () => {
    // `AUXX-CRM-` is 9 and `-R9` is 3, so 9 compacted characters are left and a
    // day key is 8 of them. The margin is one character, and it is the whole
    // reason a late memo can be posted into a claimed day at all.
    expect(MAX_COMPACT_CREDIT_MEMO_BATCH_KEY).toBe(9)
  })

  it('mints a document number that survives a reversal at every attempt', () => {
    // §2.1 makes reverse-and-repost the ONLY correction for a batched memo, so
    // a key that cannot be reversed is a group that can never be fixed.
    for (const key of ['2026-01', '2026-01-14']) {
      for (let attempt = 0; attempt <= MAX_CREDIT_MEMO_BATCH_ATTEMPT; attempt++) {
        const periodKey = creditMemoBatchPeriodKey(key, attempt)
        const reversal = buildDocNumber({ postingType: 'credit_memo', periodKey, revision: 1 })
        expect(reversal.length).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
      }
    }
    expect(buildDocNumber({ postingType: 'credit_memo', periodKey: '2026-011' })).toBe(
      'AUXX-CRM-2026011'
    )
  })

  it('carries the attempt through to the entry and its summarised lines', () => {
    const built = build([memo({ source: 'native' })], 1)
    expect(built.periodKey).toBe('2026-011')
    expect(built.entry.periodKey).toBe('2026-011')
    expect(built.entry.lines[0]?.sourceId).toBe('2026-011')
  })

  it('refuses a blank key and an attempt outside 0..35', () => {
    expect(() => creditMemoBatchPeriodKey('   ', 0)).toThrowError(/needs a group key/)
    expect(() => creditMemoBatchPeriodKey('2026-01', 1.5)).toThrowError(/whole number from 0/)
    expect(() => creditMemoBatchPeriodKey('2026-01', -1)).toThrowError(/whole number from 0/)
    expect(() =>
      creditMemoBatchPeriodKey('2026-01', MAX_CREDIT_MEMO_BATCH_ATTEMPT + 1)
    ).toThrowError(/keyspace can hold/)
  })

  it('refuses a group key too long to survive a reversal', () => {
    // Ten compacted characters posts fine at revision 0 and blows up at
    // revision 1, which is why the check is here and not in `buildDocNumber`.
    expect(() => creditMemoBatchPeriodKey('2026-01-14-12', 0)).toThrowError(/compacts to/)
    // A day key at the very top of the budget still refuses the attempt char.
    expect(() => creditMemoBatchPeriodKey('2026-01-141', 1)).toThrowError(/compacts to/)
  })
})

// ── The shared arithmetic ───────────────────────────────────────────────────

describe('computeCreditMemoAmounts is the one implementation both builders use', () => {
  it('produces the same numbers the single-memo builder reports', () => {
    const single = buildCreditMemoEntry({
      creditMemoId: 'cm-shared',
      number: 'CM-SHARED',
      issuedAt: '2026-01-14',
      currency: 'USD',
      subtotal: 10_000,
      taxTotal: 800,
      total: 10_800,
      reverseRevenue: true,
      settlement: { role: 'clearing_card', amount: 4_000 },
    })
    const amounts = computeCreditMemoAmounts({
      creditMemoId: 'cm-shared',
      number: 'CM-SHARED',
      subtotal: 10_000,
      taxTotal: 800,
      total: 10_800,
      reverseRevenue: true,
      settlement: { role: 'clearing_card', amount: 4_000 },
    })
    expect(amounts).toEqual({
      subtotalMinor: single.subtotalMinor,
      taxTotalMinor: single.taxTotalMinor,
      totalMinor: single.totalMinor,
      settlementMinor: single.settlementMinor,
      reverseRevenue: true,
    })
  })

  it('zeroes the revenue numbers and keeps the settlement when reverseRevenue is false', () => {
    expect(
      computeCreditMemoAmounts({
        creditMemoId: 'cm-x',
        number: 'CM-X',
        subtotal: 7_000,
        taxTotal: 560,
        total: 7_560,
        reverseRevenue: false,
        settlement: { role: 'clearing_card', amount: 7_560 },
      })
    ).toEqual({
      subtotalMinor: 0,
      taxTotalMinor: 0,
      totalMinor: 0,
      settlementMinor: 7_560,
      reverseRevenue: false,
    })
  })

  it('carries the resolved gateway account through, so the group can split on it', () => {
    expect(
      computeCreditMemoAmounts({
        creditMemoId: 'cm-y',
        number: 'CM-Y',
        subtotal: 1_000,
        taxTotal: 0,
        total: 1_000,
        reverseRevenue: true,
        settlement: { glAccountId: 'gl-affirm', amount: 1_000 },
      }).settlementGlAccountId
    ).toBe('gl-affirm')
  })

  it('refuses the same things the single-memo builder always refused', () => {
    const base = {
      creditMemoId: 'cm-z',
      number: 'CM-Z',
      subtotal: 1_000,
      taxTotal: 0,
      total: 1_000,
      reverseRevenue: true,
    }
    expect(expectRefusal(() => computeCreditMemoAmounts({ ...base, total: 900 })).message).toMatch(
      /ties to the stored totals/
    )
    expect(
      expectRefusal(() => computeCreditMemoAmounts({ ...base, subtotal: -1, total: -1 })).message
    ).toMatch(/is ever negative/)
    expect(
      expectRefusal(() =>
        computeCreditMemoAmounts({
          ...base,
          settlement: { role: 'clearing_card', amount: 2_000 },
        })
      ).message
    ).toMatch(/cannot have paid back more/)
    expect(
      expectRefusal(() => computeCreditMemoAmounts({ ...base, reverseRevenue: false })).message
    ).toMatch(/no entry to build/)
  })
})
