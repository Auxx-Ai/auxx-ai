// packages/lib/src/postings/__tests__/clearing-account-per-rail.test.ts
//
// plans/accounting/tasks/26-a-clearing-account-per-rail.md §12, tests 1, 2, 4
// and 6.
//
// Every other test in this directory checks one builder. This file checks the
// one thing no single builder can: that the DEBIT a fulfillment writes and the
// CREDIT a payout writes land on the SAME account.
//
// 🛑 Why that needs its own file. A fulfillment debits the gateway record's
// clearing account BY ID (`resolveFulfillmentDebit`) and, before brief 26, a
// payout credited the `clearing` ROLE unconditionally
// (`money/payouts/sync.ts:266`). Both entries balance. Both post. Nothing
// downstream compares them - so the moment any rail is routed to its own
// account the two accounts drift apart forever and the only symptom is a
// clearing balance that never reaches zero, years later, for reasons nobody can
// reconstruct. A test that exercises one side at a time cannot see it.

import { describe, expect, it } from 'vitest'
import { matchGatewayRoute } from '../../payment-gateways/client'
import { ACCOUNT_ROLES } from '../build-entry'
import {
  type FulfillmentGatewayRoute,
  resolveFulfillmentDebit,
} from '../build-fulfillment-batch-entry'
import { buildPayoutEntry } from '../build-payout-entry'

/** The gateway record under test: one rail, two spellings, its own account. */
const AUTHORIZE_NET: FulfillmentGatewayRoute = {
  handles: ['authorize_net', 'authorize.net'],
  clearingGlAccountId: 'acct_authnet_clearing',
  active: true,
}

const PAYOUT = {
  payoutId: 'po_1AbCdEfGhIjKlMnOpQrStUvW',
  payoutNumber: 'PO-0007',
  bankAccountGlAccountId: 'gl-1000',
  grossMinor: 500_000,
  feesMinor: 14_800,
  netMinor: 485_200,
  clearingRole: ACCOUNT_ROLES.CLEARING,
  paidAt: '2026-09-04',
}

/** Which account a built payout CREDITS its gross to: an id, or a role name. */
function creditedClearing(
  built: ReturnType<typeof buildPayoutEntry>
): { glAccountId: string } | { accountRole: string } {
  const leg = built.entry.lines.find(
    (row) => row.direction === 'credit' && row.amount === PAYOUT.grossMinor
  )
  if (!leg) throw new Error('the payout entry has no gross credit leg')
  if (leg.glAccountId) return { glAccountId: leg.glAccountId }
  if (leg.accountRole) return { accountRole: leg.accountRole }
  throw new Error('the gross credit leg names neither an account nor a role')
}

/** Which account a shipment DEBITS: an id, or a role name. Same shape, so they compare. */
function debitedClearing(gateway: string, routes: readonly FulfillmentGatewayRoute[]) {
  const debit = resolveFulfillmentDebit({
    financialStatus: 'paid',
    gateways: [gateway],
    gatewayRoutes: routes,
  })
  if (debit.kind !== 'debit') throw new Error(`the shipment was excluded: ${debit.reason}`)
  return 'glAccountId' in debit && debit.glAccountId
    ? { glAccountId: debit.glAccountId }
    : { accountRole: (debit as { role: string }).role }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1. §12: "the test that lets unit 1 merge without a drive."
// ─────────────────────────────────────────────────────────────────────────────

describe('an org with zero payment_gateway records is bit-for-bit unaffected', () => {
  // 🔑 The whole safety argument for this change. An org that has never opened
  // the payment gateways settings page passes NO ids and NO fee treatment, and
  // must get the entry it got yesterday - not an equivalent one, the same one.
  //
  // So this asserts the FULL line array against a frozen literal rather than
  // spot-checking legs. A regression that added, reordered, renamed or
  // re-memoed a leg would pass every `toMatchObject` in the neighbouring file
  // and fail here, which is the point.
  const built = buildPayoutEntry({ ...PAYOUT, unrecognisedNetMinor: 58_000 })

  it('produces exactly these four lines, in this order, with these memos', () => {
    expect(built.entry.lines).toEqual([
      {
        sourceType: 'payout',
        sourceId: 'po_1AbCdEfGhIjKlMnOpQrStUvW',
        glAccountId: 'gl-1000',
        direction: 'debit',
        amount: 543_200,
        memo: 'Payout PO-0007 - deposited',
        sortOrder: 0,
      },
      {
        sourceType: 'payout',
        sourceId: 'po_1AbCdEfGhIjKlMnOpQrStUvW',
        accountRole: 'payment_processing_fees',
        direction: 'debit',
        amount: 14_800,
        memo: 'Payout PO-0007 - processor fees withheld',
        sortOrder: 1,
      },
      {
        sourceType: 'payout',
        sourceId: 'po_1AbCdEfGhIjKlMnOpQrStUvW',
        accountRole: 'clearing',
        direction: 'credit',
        amount: 500_000,
        memo: 'Payout PO-0007 - gross settled',
        sortOrder: 2,
      },
      {
        sourceType: 'payout',
        sourceId: 'po_1AbCdEfGhIjKlMnOpQrStUvW',
        accountRole: 'unidentified_receipts',
        direction: 'credit',
        amount: 58_000,
        memo: 'Payout PO-0007 - settled charges auxx has no payment for',
        sortOrder: 3,
      },
    ])
  })

  it('names no gl_account id anywhere except the bank leg brief 13 already id-routed', () => {
    const ids = built.entry.lines.map((row) => row.glAccountId).filter(Boolean)
    expect(ids).toEqual(['gl-1000'])
  })

  it('reports the same totals and the same deposit', () => {
    expect(built).toMatchObject({
      periodKey: 'PO-0007',
      grossMinor: 500_000,
      feesMinor: 14_800,
      netMinor: 485_200,
      unrecognisedNetMinor: 58_000,
      depositedMinor: 543_200,
    })
    expect(built.entry.totalDebit).toBe(558_000)
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })

  it('and the fulfillment debit with no routes is unchanged too', () => {
    expect(debitedClearing('authorize_net', [])).toEqual({ accountRole: 'clearing' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test 2. §12: "the whole brief in one assertion, and it fails on main today."
// ─────────────────────────────────────────────────────────────────────────────

describe('a fulfillment for gateway G and a payout resolved to G meet', () => {
  it('hits the same glAccountId on both sides', () => {
    const debit = debitedClearing('authorize_net', [AUTHORIZE_NET])
    const credit = creditedClearing(
      buildPayoutEntry({ ...PAYOUT, clearingGlAccountId: AUTHORIZE_NET.clearingGlAccountId })
    )

    expect(debit).toEqual({ glAccountId: 'acct_authnet_clearing' })
    expect(credit).toEqual(debit)
  })

  it("meets under the rail's OTHER spelling too, because handles are a set", () => {
    // §5.1's census: `authorize_net` and `authorize.net` are one rail arriving
    // under two spellings. One record claims both, so both debit one account.
    expect(debitedClearing('authorize.net', [AUTHORIZE_NET])).toEqual(
      debitedClearing('authorize_net', [AUTHORIZE_NET])
    )
  })

  it('is exactly what FAILED before the credit side was id-routed', () => {
    // 🛑 The regression guard. This is `money/payouts/sync.ts:266` as it stood:
    // `clearingRole: ACCOUNT_ROLES.CLEARING`, hardcoded, no id. The debit
    // moves to the record's account and the credit does not, and BOTH entries
    // still balance - which is why nothing caught it for four days.
    const debit = debitedClearing('authorize_net', [AUTHORIZE_NET])
    const creditAsItWas = creditedClearing(buildPayoutEntry(PAYOUT))

    expect(creditAsItWas).toEqual({ accountRole: 'clearing' })
    expect(creditAsItWas).not.toEqual(debit)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test 4. §12: two records claiming one handle. The one silent path left.
// ─────────────────────────────────────────────────────────────────────────────

describe('two records claiming one handle', () => {
  const RIVALS: FulfillmentGatewayRoute[] = [
    { handles: ['authorize_net'], clearingGlAccountId: 'acct_a', active: true },
    { handles: ['Authorize_Net'], clearingGlAccountId: 'acct_b', active: true },
  ]

  it('falls back rather than picking one', () => {
    // `matchGatewayRoute` returns undefined at `matches.length !== 1`.
    // Guessing which of two accounts is right would put real money in one of
    // them, and the entry would balance either way.
    expect(matchGatewayRoute('authorize_net', RIVALS)).toBeUndefined()
    expect(debitedClearing('authorize_net', RIVALS)).toEqual({ accountRole: 'clearing' })
  })

  it('and the two sides still meet, on the role, which is why the fallback is safe', () => {
    // 🔑 The fallback is not merely "not wrong" - it keeps the property this
    // brief exists to establish. `resolvePayoutGateway` refuses an ambiguous
    // gateway rather than passing an id, so the payout lands on the same role
    // the shipment did. A silent pick on either side is what breaks the pair.
    expect(creditedClearing(buildPayoutEntry(PAYOUT))).toEqual(
      debitedClearing('authorize_net', RIVALS)
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test 6. §12: a closed gateway still routes its history, unchanged.
// ─────────────────────────────────────────────────────────────────────────────

describe('a closed rail', () => {
  const CLOSED: FulfillmentGatewayRoute = { ...AUTHORIZE_NET, active: false }

  it('still routes its own shipments to its own account', () => {
    // §9: a closed rail keeps its clearing account and winds it down to zero as
    // the last settlements land. Treating `active: false` as absent would move
    // a rail's money the moment somebody marked it closed - a posting change
    // disguised as a settings edit.
    expect(debitedClearing('authorize_net', [CLOSED])).toEqual({
      glAccountId: 'acct_authnet_clearing',
    })
  })

  it('and its late payout still credits the same account', () => {
    const debit = debitedClearing('authorize_net', [CLOSED])
    const credit = creditedClearing(
      buildPayoutEntry({ ...PAYOUT, clearingGlAccountId: CLOSED.clearingGlAccountId })
    )
    expect(credit).toEqual(debit)
  })
})
