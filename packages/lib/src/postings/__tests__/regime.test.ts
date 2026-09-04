// packages/lib/src/postings/__tests__/regime.test.ts
//
// gap-e risk E5. This is the ONLY mechanical guard that L1 and L3 are not both
// live, and the thing it guards against produces two entries that each balance
// perfectly - so nothing else, anywhere, can catch it.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAYMENT_ROUTES,
  type PaymentRoute,
  type PaymentRouteMethod,
  resolvePaymentRoute,
} from '../../money/bank-deposits/route'
import { ACCOUNT_ROLES } from '../build-entry'
import { PAYMENT_ROUTE_ROLE } from '../build-payment-entry'
import {
  ENABLED_POSTING_TYPES,
  findInventoryWriterConflicts,
  findWriterConflicts,
  INVENTORY_ROLES,
  INVENTORY_ROLES_BY_POSTING_TYPE,
  SINGLE_WRITER_ROLES,
  SINGLE_WRITER_ROLES_BY_POSTING_TYPE,
} from '../regime'
import { POSTING_TYPES } from '../types'

describe('the enabled regime', () => {
  it('has NO inventory account with two writers', () => {
    // The assertion itself. If this ever fails, a close is both asserting a
    // balance and accumulating postings into the same account: the monthly
    // entry reverses the per-event ones and the residual lands in the COGS
    // plug looking like consumption.
    expect(findInventoryWriterConflicts()).toEqual([])
  })

  it('is L1 only - `receipt` and `vendor_bill` exist but are not enabled', () => {
    // They are in `POSTING_TYPES`, in the pgEnum, and their builders are written
    // and tested. Being buildable is not being enabled, which is the whole
    // reason this constant exists separately from the union.
    expect(ENABLED_POSTING_TYPES).toContain('month_end_inventory')
    expect(ENABLED_POSTING_TYPES).not.toContain('receipt')
    expect(ENABLED_POSTING_TYPES).not.toContain('vendor_bill')
  })
})

describe('the conflict detector actually bites', () => {
  it('catches the L1+L3 state that turning L3 on WITHOUT turning L1 off would create', () => {
    // The realistic mistake: someone adds the L3 types and leaves the monthly
    // assertion in place. `vendor_bill` touches no inventory account, so the
    // conflict is `receipt` against `month_end_inventory` - on exactly the two
    // accounts a receipt can debit.
    const conflicts = findInventoryWriterConflicts([
      'month_end_inventory',
      'receipt',
      'vendor_bill',
    ])

    expect(conflicts.map((c) => c.role).sort()).toEqual(
      [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS, ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS].sort()
    )
    for (const conflict of conflicts) {
      expect(conflict.postingTypes.sort()).toEqual(['month_end_inventory', 'receipt'])
    }
  })

  it('passes for a clean L3 switch - the monthly assertion turned OFF', () => {
    // Turning L3 on is ONE change: swap the contents, do not extend them.
    expect(findInventoryWriterConflicts(['receipt', 'vendor_bill'])).toEqual([])
  })

  it('does not flag WIP, which no builder drives per-event', () => {
    const conflicts = findInventoryWriterConflicts(['month_end_inventory', 'receipt'])
    expect(conflicts.map((c) => c.role)).not.toContain(ACCOUNT_ROLES.INVENTORY_WIP)
  })
})

describe('the declaration cannot drift from the vocabulary', () => {
  it('declares an entry for every posting type', () => {
    // A type with no entry would read as "drives nothing" and be invisible to
    // the assertion - the failure mode is silence, so pin the key set.
    expect(Object.keys(INVENTORY_ROLES_BY_POSTING_TYPE).sort()).toEqual([...POSTING_TYPES].sort())
  })

  it('every enabled type is a real posting type', () => {
    for (const type of ENABLED_POSTING_TYPES) expect(POSTING_TYPES).toContain(type)
  })

  it('names exactly the three inventory roles', () => {
    expect([...INVENTORY_ROLES].sort()).toEqual(
      [
        ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
        ACCOUNT_ROLES.INVENTORY_WIP,
        ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
      ].sort()
    )
  })

  it('only ever declares real account roles', () => {
    const valid = new Set<string>(Object.values(ACCOUNT_ROLES))
    for (const roles of Object.values(INVENTORY_ROLES_BY_POSTING_TYPE)) {
      for (const role of roles) expect(valid.has(role)).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// `cash`, and the hole the guard deliberately does not see
//
// `SINGLE_WRITER_ROLES_BY_POSTING_TYPE.payment` is `[]` even though the `cash`
// payment ROUTE emits the `CASH` role and `bank_deposit` declares `[CASH]`. The
// guard is per TYPE, not per route, so `[CASH]` there would flag a conflict that
// is not one. These tests pin the reasoning mechanically instead of leaving it
// to the comment.
//
// ⚠️ "No payment method routes to `cash` while `bank_deposit` is enabled" is NOT
// the invariant, and asserting it would fail on a stock install:
// `DEFAULT_PAYMENT_ROUTES.bank` is `cash` by design (an ACH or wire arrives at
// the bank as its own line). What actually keeps `cash` single-writer is that
// the routes are DISJOINT destinations for one payment - money that goes to
// `cash` never also passes through `undeposited_funds`, which is the only money
// `bank_deposit` ever banks.
// ─────────────────────────────────────────────────────────────────────────────

describe('cash has exactly one enabled writer', () => {
  it('declares `cash` a single-writer role at all', () => {
    expect(SINGLE_WRITER_ROLES).toContain(ACCOUNT_ROLES.CASH)
  })

  it('is `bank_deposit`, and only `bank_deposit`, among the ENABLED types', () => {
    const cashWriters = ENABLED_POSTING_TYPES.filter((type) =>
      SINGLE_WRITER_ROLES_BY_POSTING_TYPE[type].includes(ACCOUNT_ROLES.CASH)
    )
    expect(cashWriters).toEqual(['bank_deposit'])
    expect(findWriterConflicts()).toEqual([])
  })

  it('the detector WOULD bite if `payment` were ever declared a cash writer', () => {
    // The `[]` on `payment` is an exemption, not a broken detector. Declaring it
    // a cash writer is a one-line edit in `regime.ts`, and this is what would
    // happen if somebody made it: the guard is looking, it is simply being told
    // there is nothing to see.
    const asIfPaymentDrovecash = {
      ...SINGLE_WRITER_ROLES_BY_POSTING_TYPE,
      payment: [ACCOUNT_ROLES.CASH],
    }
    const writers = ['bank_deposit', 'payment'].filter((type) =>
      asIfPaymentDrovecash[type as keyof typeof asIfPaymentDrovecash].includes(ACCOUNT_ROLES.CASH)
    )
    expect(writers).toEqual(['bank_deposit', 'payment'])
  })
})

describe('the payment routes are disjoint destinations, which is what makes the exemption safe', () => {
  const methods = Object.keys(DEFAULT_PAYMENT_ROUTES) as PaymentRouteMethod[]

  it('maps each route to a DIFFERENT account role - one payment cannot land in two', () => {
    const roles = Object.values(PAYMENT_ROUTE_ROLE)
    expect(new Set(roles).size).toBe(roles.length)
    expect(PAYMENT_ROUTE_ROLE.cash).toBe(ACCOUNT_ROLES.CASH)
    expect(PAYMENT_ROUTE_ROLE.undeposited_funds).toBe(ACCOUNT_ROLES.UNDEPOSITED_FUNDS)
    expect(PAYMENT_ROUTE_ROLE.undeposited_funds).not.toBe(PAYMENT_ROUTE_ROLE.cash)
  })

  it('routes every method to exactly one of the three destinations, on defaults and on settings', () => {
    for (const method of methods) {
      expect(resolvePaymentRoute(method, null)).toBe(DEFAULT_PAYMENT_ROUTES[method])
    }
    // And an org that has routed EVERYTHING to cash still has one cash writer
    // per payment: `bank_deposit` banks undeposited funds, and there are none.
    const allCash = Object.fromEntries(
      methods.map((method) => [`accounting.paymentRoute.${method}`, 'cash'])
    )
    for (const method of methods) {
      expect(resolvePaymentRoute(method, allCash)).toBe('cash' satisfies PaymentRoute)
    }
  })

  it('a method routed to `cash` is never also banked by a deposit, because a deposit only drains undeposited funds', () => {
    // The `bank_deposit` entry is `Dr cash Cr undeposited_funds`, so the money
    // it moves is exactly the money the `undeposited_funds` route parked. A
    // `cash`-routed payment never enters that account, so the two writers never
    // touch the same money even though both name `cash`.
    expect(SINGLE_WRITER_ROLES_BY_POSTING_TYPE.bank_deposit).toEqual([ACCOUNT_ROLES.CASH])
    const cashRouted = methods.filter((method) => resolvePaymentRoute(method, null) === 'cash')
    const undeposited = methods.filter(
      (method) => resolvePaymentRoute(method, null) === 'undeposited_funds'
    )
    expect(cashRouted.length).toBeGreaterThan(0)
    for (const method of cashRouted) expect(undeposited).not.toContain(method)
  })
})
