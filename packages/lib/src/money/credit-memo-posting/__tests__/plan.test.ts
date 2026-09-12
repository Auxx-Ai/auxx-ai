// packages/lib/src/money/credit-memo-posting/__tests__/plan.test.ts
//
// `planCreditMemoPosting` is the whole decision behind the bulk credit memo
// poster and it touches nothing, so this file is where the painful cases live:
// the exclusion PRIORITY order, a group that mixes revenue-reversing and
// money-only members (§3.1 item 3), and the settlement account that must stay
// per memo.
//
// 🛑 `computeCreditMemoAmounts` is used FOR REAL here, not stubbed. It is pure,
// and the thing worth asserting is that the plan and the builder agree about
// what one memo is worth - a stub would assert only that the plan calls
// something.
//
// Amounts are integer minor units: 10_000 = $100.00.

import { describe, expect, it } from 'vitest'
import { groupKeyFor, planCreditMemoPosting } from '../plan'
import type {
  CreditMemoPostingGrouping,
  CreditMemoPostingPlanInput,
  UnpostedCreditMemo,
} from '../types'

/** One issued, fully refunded $100 channel memo on a shipped order. */
function memo(overrides: Partial<UnpostedCreditMemo> = {}): UnpostedCreditMemo {
  return {
    creditMemoId: 'cm_1',
    number: 'CM-0001',
    issuedAt: '2026-01-14',
    status: 'issued',
    source: 'channel',
    currency: 'USD',
    subtotalMinor: 10_000,
    taxTotalMinor: 0,
    totalMinor: 10_000,
    amountRefundedMinor: 10_000,
    contactId: 'ct_1',
    orderId: 'ord_1',
    reverseRevenue: true,
    ...overrides,
  }
}

function plan(
  memos: UnpostedCreditMemo[],
  overrides: Partial<
    Omit<CreditMemoPostingPlanInput, 'memos'> & {
      settlementAccounts: ReadonlyMap<string, string>
      unpostedShipments: number
    }
  > = {}
) {
  return planCreditMemoPosting({
    memos,
    grouping: 'day',
    cutoffPeriod: null,
    lockedThroughMonth: null,
    ledgerCurrency: 'USD',
    timeZone: 'America/Los_Angeles',
    issueDrafts: false,
    ...overrides,
  })
}

describe('grouping', () => {
  it('puts every memo of a day in one group and keys it on the day', () => {
    const result = plan([
      memo({ creditMemoId: 'a', number: 'CM-0001' }),
      memo({ creditMemoId: 'b', number: 'CM-0002', contactId: 'ct_2' }),
    ])

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.groupKey).toBe('2026-01-14')
    expect(result.groups[0]?.memos.map((m) => m.number)).toEqual(['CM-0001', 'CM-0002'])
  })

  it('keys a month group on the month and keeps two days in it', () => {
    const result = plan(
      [
        memo({ creditMemoId: 'a', number: 'CM-0001', issuedAt: '2026-01-14' }),
        memo({ creditMemoId: 'b', number: 'CM-0002', issuedAt: '2026-01-31' }),
      ],
      { grouping: 'month' }
    )

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.groupKey).toBe('2026-01')
  })

  it('splits two days into two groups when grouping by day', () => {
    const result = plan([
      memo({ creditMemoId: 'a', number: 'CM-0001', issuedAt: '2026-01-14' }),
      memo({ creditMemoId: 'b', number: 'CM-0002', issuedAt: '2026-01-31' }),
    ])

    expect(result.groups.map((group) => group.groupKey)).toEqual(['2026-01-14', '2026-01-31'])
  })

  // 🛑 The LATEST issue date, never the group key's own start: a month posted on
  // the first would date the whole month's returns into the day it opened.
  it('dates a month group on the latest issue date in it', () => {
    const result = plan(
      [
        memo({ creditMemoId: 'a', number: 'CM-0001', issuedAt: '2026-01-02' }),
        memo({ creditMemoId: 'b', number: 'CM-0002', issuedAt: '2026-01-29' }),
      ],
      { grouping: 'month' }
    )

    expect(result.groups[0]?.txnDate).toBe('2026-01-29')
  })

  it('exposes the same key function the run and the dialog use', () => {
    const groupings: CreditMemoPostingGrouping[] = ['day', 'month']

    expect(groupings.map((grouping) => groupKeyFor('2026-01-14', grouping))).toEqual([
      '2026-01-14',
      '2026-01',
    ])
  })
})

describe('determinism', () => {
  it('returns the same plan whatever order the memos arrive in', () => {
    const memos = [
      memo({ creditMemoId: 'c', number: 'CM-0003', issuedAt: '2026-01-31' }),
      memo({ creditMemoId: 'a', number: 'CM-0001', issuedAt: '2026-01-14' }),
      memo({ creditMemoId: 'b', number: 'CM-0002', issuedAt: '2026-01-14' }),
    ]

    const forward = plan(memos)
    const backward = plan([...memos].reverse())

    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward))
    expect(forward.groups[0]?.memos.map((m) => m.number)).toEqual(['CM-0001', 'CM-0002'])
  })

  it('orders exclusions the same way, whatever order they arrive in', () => {
    const memos = [
      memo({ creditMemoId: 'b', number: 'CM-0002', status: 'void' }),
      memo({ creditMemoId: 'a', number: 'CM-0001', status: 'draft' }),
    ]

    expect(plan(memos).exclusions.map((e) => e.number)).toEqual(['CM-0001', 'CM-0002'])
    expect(plan([...memos].reverse()).exclusions.map((e) => e.number)).toEqual([
      'CM-0001',
      'CM-0002',
    ])
  })
})

// 🛑 The order of these `if`s IS the contract: reporting a memo as `zero-value`
// when it is really in a closed period sends somebody to look at the document
// instead of at the period.
describe('the exclusion priority order', () => {
  const everythingWrong = {
    status: 'draft',
    issuedAt: '2025-03-04',
    currency: 'EUR',
    contactId: null,
    subtotalMinor: 0,
    taxTotalMinor: 0,
    totalMinor: 0,
  } satisfies Partial<UnpostedCreditMemo>
  const settings = { cutoffPeriod: '2025-06', lockedThroughMonth: '2025-06' }

  it('reports a draft as not-issued before anything else', () => {
    const result = plan([memo(everythingWrong)], settings)

    expect(result.exclusions).toEqual([
      {
        creditMemoId: 'cm_1',
        number: 'CM-0001',
        issuedAt: '2025-03-04',
        reason: 'not-issued',
        detail: 'draft',
      },
    ])
  })

  it('reports a void memo as not-issued too', () => {
    expect(
      plan([memo({ ...everythingWrong, status: 'void' })], settings).exclusions[0]
    ).toMatchObject({ reason: 'not-issued', detail: 'void' })
  })

  // Fail CLOSED: an option id nobody has taught this module about is not a
  // postable document, and guessing it is would recognise a return twice.
  it('reports an unknown status as not-issued rather than posting it', () => {
    expect(plan([memo({ status: 'pending_review' })]).exclusions[0]).toMatchObject({
      reason: 'not-issued',
      detail: 'pending_review',
    })
  })

  it('posts a settled memo, which is issued and then settled', () => {
    expect(plan([memo({ status: 'settled' })]).groups).toHaveLength(1)
  })

  it('reports before-cutoff next, and carries the cutoff month as the proof', () => {
    const result = plan([memo({ ...everythingWrong, status: 'issued' })], settings)

    expect(result.exclusions[0]).toMatchObject({ reason: 'before-cutoff', detail: '2025-06' })
  })

  it('reports locked-period next, and carries the locked month as the proof', () => {
    const result = plan([memo({ ...everythingWrong, status: 'issued' })], {
      lockedThroughMonth: '2025-06',
    })

    expect(result.exclusions[0]).toMatchObject({ reason: 'locked-period', detail: '2025-06' })
  })

  it('reports foreign-currency next, and carries the currency as the proof', () => {
    const result = plan([memo({ ...everythingWrong, status: 'issued', issuedAt: '2026-01-14' })])

    expect(result.exclusions[0]).toMatchObject({ reason: 'foreign-currency', detail: 'EUR' })
  })

  it('reports missing-contact next', () => {
    const result = plan([
      memo({ ...everythingWrong, status: 'issued', issuedAt: '2026-01-14', currency: 'USD' }),
    ])

    expect(result.exclusions[0]?.reason).toBe('missing-contact')
  })

  it('reports zero-value last, carrying the refusal verbatim', () => {
    const result = plan([
      memo({
        ...everythingWrong,
        status: 'issued',
        issuedAt: '2026-01-14',
        currency: 'USD',
        contactId: 'ct_1',
        amountRefundedMinor: 0,
      }),
    ])

    expect(result.exclusions[0]?.reason).toBe('zero-value')
    expect(result.exclusions[0]?.detail).toMatch(/credits nothing/)
  })

  it('treats a blank currency as the ledger currency rather than as foreign', () => {
    expect(plan([memo({ currency: '  ' })]).groups).toHaveLength(1)
    expect(plan([memo({ currency: null })]).groups).toHaveLength(1)
  })

  it('excludes a memo once, never twice', () => {
    const result = plan([memo(everythingWrong)], settings)

    expect(result.exclusions).toHaveLength(1)
    expect(result.footer.excluded).toBe(1)
  })
})

// 🛑 Channel memos are INGESTED as `draft` - all 1,061 of DemoOrg1's - so a
// planner that always excludes a draft excludes the entire backlog and posts
// nothing. §7's `not-issued` was written as though somebody had already issued
// them one at a time, and nothing bulk-issues.
describe('issueDrafts', () => {
  it('plans a draft as a member instead of excluding it', () => {
    const result = plan([memo({ status: 'draft' })], { issueDrafts: true })

    expect(result.exclusions).toEqual([])
    expect(result.groups[0]?.memos.map((m) => m.number)).toEqual(['CM-0001'])
  })

  it('counts the planned drafts in the footer, so the dialog can say so', () => {
    const result = plan(
      [
        memo({ creditMemoId: 'a', number: 'CM-0001', status: 'draft' }),
        memo({ creditMemoId: 'b', number: 'CM-0002', status: 'issued', contactId: 'ct_2' }),
        memo({ creditMemoId: 'c', number: 'CM-0003', status: 'settled', contactId: 'ct_3' }),
      ],
      { issueDrafts: true }
    )

    expect(result.footer.memos).toBe(3)
    expect(result.footer.drafts).toBe(1)
  })

  // A draft the plan EXCLUDED is not a document state this run changes.
  it('does not count an excluded draft as one it will issue', () => {
    const result = plan([memo({ status: 'draft', currency: 'EUR' })], { issueDrafts: true })

    expect(result.footer.drafts).toBe(0)
    expect(result.exclusions[0]?.reason).toBe('foreign-currency')
  })

  it('reports zero drafts when the flag is off, whatever is in the range', () => {
    const result = plan([memo({ status: 'draft' })])

    expect(result.footer.drafts).toBe(0)
    expect(result.footer.memos).toBe(0)
  })

  // 🛑 `draft` and nothing else. A void memo is never resurrected.
  it('still excludes a void memo as not-issued', () => {
    const result = plan([memo({ status: 'void' })], { issueDrafts: true })

    expect(result.groups).toEqual([])
    expect(result.exclusions[0]).toMatchObject({ reason: 'not-issued', detail: 'void' })
  })

  // Fail CLOSED: an option id nobody has taught this module about is not a
  // draft, so `issueDrafts` does not make it postable either.
  it('still excludes an unknown status as not-issued', () => {
    const result = plan([memo({ status: 'pending_review' })], { issueDrafts: true })

    expect(result.exclusions[0]).toMatchObject({ reason: 'not-issued', detail: 'pending_review' })
  })

  it('leaves the plan exactly as it was when the flag is off', () => {
    const memos = [
      memo({ creditMemoId: 'a', number: 'CM-0001', status: 'draft' }),
      memo({ creditMemoId: 'b', number: 'CM-0002', status: 'issued', contactId: 'ct_2' }),
    ]

    const result = plan(memos)

    expect(result.groups[0]?.memos.map((m) => m.number)).toEqual(['CM-0002'])
    expect(result.exclusions).toEqual([
      {
        creditMemoId: 'a',
        number: 'CM-0001',
        issuedAt: '2026-01-14',
        reason: 'not-issued',
        detail: 'draft',
      },
    ])
  })

  // 🛑 `run.ts` issues a planned draft through `resolveIssue`, which refuses
  // without a contact or a number, so the planner must not promise one.
  describe('the refusals resolveIssue would apply', () => {
    it('excludes a draft with no contact as missing-contact', () => {
      const result = plan([memo({ status: 'draft', contactId: null })], { issueDrafts: true })

      expect(result.exclusions[0]?.reason).toBe('missing-contact')
    })

    it('excludes a draft with no number as missing-number', () => {
      const result = plan([memo({ status: 'draft', number: '' })], { issueDrafts: true })

      expect(result.exclusions[0]).toMatchObject({
        reason: 'missing-number',
        detail: 'credit_memo_number is empty',
      })
    })

    it('excludes a draft whose number is blank as missing-number', () => {
      const result = plan([memo({ status: 'draft', number: '   ' })], { issueDrafts: true })

      expect(result.exclusions[0]?.reason).toBe('missing-number')
    })

    it('reports missing-contact before missing-number, as resolveIssue does', () => {
      const result = plan([memo({ status: 'draft', contactId: null, number: '' })], {
        issueDrafts: true,
      })

      expect(result.exclusions).toHaveLength(1)
      expect(result.exclusions[0]?.reason).toBe('missing-contact')
    })

    it('excludes a draft that credits nothing as zero-value', () => {
      const result = plan(
        [
          memo({
            status: 'draft',
            subtotalMinor: 0,
            taxTotalMinor: 0,
            totalMinor: 0,
            amountRefundedMinor: 0,
          }),
        ],
        { issueDrafts: true }
      )

      expect(result.exclusions[0]?.reason).toBe('zero-value')
    })

    // ⚠️ Only a memo this run would ISSUE. A batch entry keys its document
    // number on the PERIOD, so an already-issued memo with an unallocated
    // number posts inside one perfectly well.
    it('posts an already-issued memo with no number rather than refusing it', () => {
      const result = plan([memo({ status: 'issued', number: '' })], { issueDrafts: true })

      expect(result.exclusions).toEqual([])
      expect(result.groups).toHaveLength(1)
    })
  })
})

// §7 and `types.ts`: a sale can be refused and re-run, a refund cannot, because
// the money has already moved.
describe('the reasons that deliberately do not exist', () => {
  it('posts a memo whose order names two gateways rather than refusing it', () => {
    // Two gateways resolve to no account at all, so the memo arrives here with
    // no entry in the settlement map - the `clearing_card` fallback.
    const result = plan([memo()], { settlementAccounts: new Map() })

    expect(result.exclusions).toEqual([])
    expect(result.groups[0]?.memos[0]?.amounts.settlementGlAccountId).toBeUndefined()
  })
})

// §3.1 item 1: an Affirm memo and a card memo in one group must stay two credit
// lines, or `1210` is overstated forever in an entry that balances.
describe('the settlement account', () => {
  it('freezes the resolved account onto the memo and never onto the group', () => {
    const result = plan(
      [
        memo({ creditMemoId: 'affirm', number: 'CM-0001' }),
        memo({ creditMemoId: 'card', number: 'CM-0002' }),
      ],
      { settlementAccounts: new Map([['affirm', 'acct_1210']]) }
    )

    const accounts = result.groups[0]?.memos.map((m) => m.amounts.settlementGlAccountId)
    expect(accounts).toEqual(['acct_1210', undefined])
  })

  // A native memo's refund moves as a `PaymentTransaction` and posts through the
  // payment builder: crediting a clearing account here too would refund the same
  // money twice in the books.
  it('gives a native memo no settlement, whatever its refunded figure says', () => {
    const result = plan([memo({ source: 'native', amountRefundedMinor: 10_000 })])

    expect(result.groups[0]?.memos[0]?.amounts.settlementMinor).toBe(0)
    expect(result.groups[0]?.totals.receivableMinor).toBe(10_000)
  })

  it('gives a channel memo that refunded nothing no settlement either', () => {
    const result = plan([memo({ amountRefundedMinor: 0 })])

    expect(result.groups[0]?.memos[0]?.amounts.settlementMinor).toBe(0)
  })
})

// §3.1 item 3, the CM-0091 case: a channel memo whose order never shipped before
// `issuedAt` reverses revenue that was never posted.
describe('a group that mixes reverseRevenue', () => {
  const mixed = [
    memo({
      creditMemoId: 'shipped',
      number: 'CM-0001',
      reverseRevenue: true,
      subtotalMinor: 10_000,
      taxTotalMinor: 800,
      totalMinor: 10_800,
      amountRefundedMinor: 10_800,
    }),
    memo({
      creditMemoId: 'never_shipped',
      number: 'CM-0002',
      contactId: 'ct_2',
      reverseRevenue: false,
      subtotalMinor: 5_000,
      taxTotalMinor: 400,
      totalMinor: 5_400,
      amountRefundedMinor: 5_400,
    }),
  ]

  it('keeps both members in ONE group, never split', () => {
    const result = plan(mixed)

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.memos).toHaveLength(2)
  })

  it('omits the money-only member from the revenue totals and keeps its settlement', () => {
    const totals = plan(mixed).groups[0]?.totals

    expect(totals).toEqual({
      subtotalMinor: 10_000,
      taxTotalMinor: 800,
      totalMinor: 10_800,
      settlementMinor: 16_200,
      // The money-only member's share is NEGATIVE - a debit, exactly as the
      // single-memo builder's money leg is `Dr accounts_receivable`.
      receivableMinor: -5_400,
    })
  })

  it('zeroes the money-only member and leaves the other alone', () => {
    const [shipped, neverShipped] = plan(mixed).groups[0]?.memos ?? []

    expect(shipped?.amounts).toMatchObject({
      subtotalMinor: 10_000,
      taxTotalMinor: 800,
      totalMinor: 10_800,
      settlementMinor: 10_800,
      reverseRevenue: true,
    })
    expect(neverShipped?.amounts).toMatchObject({
      subtotalMinor: 0,
      taxTotalMinor: 0,
      totalMinor: 0,
      settlementMinor: 5_400,
      reverseRevenue: false,
    })
  })

  // A money-only member's total is zero BY CONSTRUCTION. The fulfillment
  // poster's `totalMinor <= 0` test would exclude it as `zero-value` and the
  // refund would never leave clearing.
  it('does not mistake a money-only member for a zero-value memo', () => {
    const result = plan([mixed[1] as UnpostedCreditMemo])

    expect(result.exclusions).toEqual([])
    expect(result.groups[0]?.memos[0]?.amounts.settlementMinor).toBe(5_400)
  })

  // `computeCreditMemoAmounts` refuses a memo with neither a revenue leg nor a
  // settlement, and the planner turns that into one exclusion.
  it('excludes a money-only member that refunded nothing', () => {
    const result = plan([memo({ reverseRevenue: false, amountRefundedMinor: 0 })])

    expect(result.exclusions[0]?.reason).toBe('zero-value')
    expect(result.exclusions[0]?.detail).toMatch(/no entry to build/)
  })
})

describe('the A/R line count', () => {
  it('counts one contact per distinct counterparty with a remainder', () => {
    const result = plan([
      memo({ creditMemoId: 'a', number: 'CM-0001', contactId: 'ct_1', amountRefundedMinor: 0 }),
      memo({ creditMemoId: 'b', number: 'CM-0002', contactId: 'ct_1', amountRefundedMinor: 0 }),
      memo({ creditMemoId: 'c', number: 'CM-0003', contactId: 'ct_2', amountRefundedMinor: 0 }),
    ])

    expect(result.groups[0]?.contactCount).toBe(2)
    expect(result.footer.contacts).toBe(2)
  })

  // Usually zero lines for an all-channel group, because the money already went
  // back: the builder drops a zero leg, so counting it would promise a line the
  // entry does not carry.
  it('counts no contact when every memo settled in full', () => {
    const result = plan([memo(), memo({ creditMemoId: 'b', number: 'CM-0002', contactId: 'ct_2' })])

    expect(result.groups[0]?.contactCount).toBe(0)
    expect(result.footer.contacts).toBe(2)
  })

  it('counts a contact whose members net to a debit', () => {
    const result = plan([
      memo({
        reverseRevenue: false,
        subtotalMinor: 5_000,
        taxTotalMinor: 0,
        totalMinor: 5_000,
        amountRefundedMinor: 5_000,
      }),
    ])

    expect(result.groups[0]?.contactCount).toBe(1)
  })
})

describe('the footer', () => {
  it('counts the postings, the memos, the contacts, the exclusions and the total', () => {
    const result = plan([
      memo({ creditMemoId: 'a', number: 'CM-0001', issuedAt: '2026-01-14' }),
      memo({ creditMemoId: 'b', number: 'CM-0002', issuedAt: '2026-01-15', contactId: 'ct_2' }),
      memo({ creditMemoId: 'c', number: 'CM-0003', status: 'draft' }),
    ])

    expect(result.footer).toEqual({
      postings: 2,
      memos: 2,
      contacts: 2,
      drafts: 0,
      excluded: 1,
      totalMinor: 20_000,
    })
  })

  it('reports an empty range as an empty plan rather than as a refusal', () => {
    const result = plan([])

    expect(result.groups).toEqual([])
    expect(result.exclusions).toEqual([])
    expect(result.footer.postings).toBe(0)
    expect(result.unpostedShipmentWarning).toBeNull()
  })
})

// §8: a WARNING, never a refusal. It nets out within the month, so refusing
// would be stronger than the problem.
describe('the ordering warning', () => {
  it('carries the shipment count when shipments still owe the ledger a posting', () => {
    expect(plan([memo()], { unpostedShipments: 12 }).unpostedShipmentWarning).toEqual({
      shipments: 12,
    })
  })

  it('is null at zero, and never refuses the plan', () => {
    const result = plan([memo()], { unpostedShipments: 0 })

    expect(result.unpostedShipmentWarning).toBeNull()
    expect(result.groups).toHaveLength(1)
  })

  it('still posts everything when the warning is set', () => {
    expect(plan([memo()], { unpostedShipments: 500 }).groups).toHaveLength(1)
  })
})

// Total on every input: an amount the shared arithmetic refuses is one
// exclusion, never a thrown run over a thousand memos.
describe('never throws', () => {
  const broken: Array<[string, Partial<UnpostedCreditMemo>]> = [
    ['a total that does not sum', { subtotalMinor: 10_000, taxTotalMinor: 0, totalMinor: 9_000 }],
    ['a negative subtotal', { subtotalMinor: -1, taxTotalMinor: 0, totalMinor: -1 }],
    ['a refund larger than the credit', { amountRefundedMinor: 99_999 }],
    ['a NaN total', { totalMinor: Number.NaN }],
    ['a fractional total', { subtotalMinor: 10_000.5, taxTotalMinor: 0, totalMinor: 10_000.5 }],
  ]

  for (const [what, overrides] of broken) {
    it(`reports ${what} as one exclusion`, () => {
      const result = plan([memo(overrides), memo({ creditMemoId: 'ok', number: 'CM-0009' })])

      expect(result.exclusions).toHaveLength(1)
      expect(result.exclusions[0]?.reason).toBe('zero-value')
      expect(result.exclusions[0]?.detail.length).toBeGreaterThan(0)
      // 🛑 The rest of the range is untouched: one bad row must not take down a
      // run over a thousand memos.
      expect(result.groups[0]?.memos.map((m) => m.number)).toEqual(['CM-0009'])
    })
  }
})
