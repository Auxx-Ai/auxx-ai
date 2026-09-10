// packages/lib/src/postings/__tests__/regime.test.ts
//
// gap-e risk E5. This is the ONLY mechanical guard that L1 and L3 are not both
// live, and the thing it guards against produces two entries that each balance
// perfectly - so nothing else, anywhere, can catch it.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAYMENT_ROUTES,
  type PaymentRouteMethod,
  resolvePaymentRoute,
} from '../../money/bank-deposits/route'
import { ACCOUNT_ROLES } from '../build-entry'
import { PAYMENT_ROUTE_ROLE } from '../build-payment-entry'
import {
  ENABLED_POSTING_TYPES,
  EXPORT_ROUTE_BY_POSTING_TYPE,
  findInventoryWriterConflicts,
  findWriterConflicts,
  INVENTORY_ROLES,
  INVENTORY_ROLES_BY_POSTING_TYPE,
  SINGLE_WRITER_ROLES,
  SINGLE_WRITER_ROLES_BY_POSTING_TYPE,
} from '../regime'
import { POSTING_TYPES, type PostingType } from '../types'

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
// `cash` retired as a posting role (brief 13 §2). It named a bank account by
// its own `glAccountId` from the start of this pass, so there is no role for
// this guard to see and no exemption left to reason about: `bank_deposit` and
// `payment` are genuinely `[]` now, not `[]` standing in for `[CASH]`.
// ─────────────────────────────────────────────────────────────────────────────

describe('cash is gone as a role, and the guard is narrowed back to inventory', () => {
  it('SINGLE_WRITER_ROLES is exactly the three inventory roles', () => {
    expect([...SINGLE_WRITER_ROLES].sort()).toEqual([...INVENTORY_ROLES].sort())
  })

  it('no posting type declares a non-inventory single-writer role', () => {
    const valid = new Set<string>(INVENTORY_ROLES)
    for (const roles of Object.values(SINGLE_WRITER_ROLES_BY_POSTING_TYPE)) {
      for (const role of roles) expect(valid.has(role)).toBe(true)
    }
  })

  it('`bank_deposit` and `payment` declare no single-writer role at all', () => {
    expect(SINGLE_WRITER_ROLES_BY_POSTING_TYPE.bank_deposit).toEqual([])
    expect(SINGLE_WRITER_ROLES_BY_POSTING_TYPE.payment).toEqual([])
  })

  it('the enabled regime still has no writer conflict', () => {
    expect(findWriterConflicts()).toEqual([])
  })

  it('the `cash` payment route resolves to a bank account, not a role', () => {
    expect(PAYMENT_ROUTE_ROLE.cash).toEqual({ kind: 'bank_account' })
  })

  it('every default payment route still resolves to exactly one destination', () => {
    const methods = Object.keys(DEFAULT_PAYMENT_ROUTES) as PaymentRouteMethod[]
    for (const method of methods) {
      expect(resolvePaymentRoute(method, null)).toBe(DEFAULT_PAYMENT_ROUTES[method])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The export route, brief 14 (plans/accounting/tasks/14-one-quickbooks-two-
// write-paths.md) §3 and §3.2. A per-type table cannot express "a family goes
// one way", so this declares the families directly and asserts every member of
// a family shares a route. Retired 2026-09-10 on MK's decision (brief 14's
// DECIDED block): the invoice document mirror is gone. Every family routes
// `journal` except `opening` (brief 19 §5.1), which routes `none` - an opening
// balance is one entry per org, keyed on the cutover date, and is never
// exported to the provider it may have been sourced from, so pushing it back
// would double every balance in it.
// ─────────────────────────────────────────────────────────────────────────────

/** The document families brief 14 §2.3 named, kept as the guard even though every family routes uniformly. */
const POSTING_FAMILIES: Record<string, readonly PostingType[]> = {
  documents: ['invoice_issued', 'credit_memo', 'payment', 'deposit_application', 'write_off'],
  inventory: [
    'month_end_inventory',
    'receipt',
    'vendor_bill',
    'fulfillment',
    'build',
    'month_end_deferral',
    'month_end_reversal',
  ],
  // A generated occurrence of a recurring template is a manual journal a
  // scheduler wrote rather than a person, so it sits beside one. It gets its
  // OWN posting type only because the claim index is the exact idempotency
  // layer and `manual_journal`'s key shape cannot carry a `(rule, occurrence)`
  // pair (brief 21 §1.4).
  manual: ['manual_journal', 'recurring_journal'],
  opening: ['opening_balance'],
  banking: ['bank_deposit', 'bank_transaction', 'payout'],
  // Its own family, because it is the only one auxx did not author: the
  // accountant's entry, read back off the provider's ledger (brief 20 §6).
  sync: ['provider_sync'],
  // `Dr <expense> / Cr A/P` for rent, insurance, a legal invoice. NOT in the
  // `inventory` family beside `vendor_bill`: that one is the L3 purchasing
  // story and this one touches no inventory account, no GRNI and no three-way
  // match (brief 21 §3.2).
  payables: ['expense_bill'],
}

describe('the export route is declared, total, and per family', () => {
  it('declares an entry for every posting type', () => {
    expect(Object.keys(EXPORT_ROUTE_BY_POSTING_TYPE).sort()).toEqual([...POSTING_TYPES].sort())
  })

  it('the families cover exactly the posting-type vocabulary, with no type in two families', () => {
    const familyTypes = Object.values(POSTING_FAMILIES).flat()
    expect([...familyTypes].sort()).toEqual([...POSTING_TYPES].sort())
    expect(new Set(familyTypes).size).toBe(familyTypes.length)
  })

  it('every posting type in a family shares that family route', () => {
    for (const [family, types] of Object.entries(POSTING_FAMILIES)) {
      const routes = new Set(types.map((type) => EXPORT_ROUTE_BY_POSTING_TYPE[type]))
      expect(routes.size, `family "${family}" has more than one route: ${[...routes]}`).toBe(1)
    }
  })

  it('`opening_balance` and `provider_sync` route `none`, and every other type routes `journal`', () => {
    const inbound = new Set<string>(['opening_balance', 'provider_sync'])
    for (const [type, route] of Object.entries(EXPORT_ROUTE_BY_POSTING_TYPE)) {
      if (inbound.has(type)) {
        expect(route, `"${type}" came FROM the provider and may never be pushed back`).toBe('none')
      } else {
        expect(route).toBe('journal')
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Brief 20 §6, and this is the load-bearing block of the file for the inbound
// half. Everything else in `provider-sync/` can be rebuilt from the report; a
// `provider_sync` entry that acquires a `journal` route cannot be undone,
// because the second copy balances, every statement still ties, and nothing
// downstream can tell the two apart.
// ─────────────────────────────────────────────────────────────────────────────

describe('the loop guard', () => {
  it('never pushes a synced entry back at the provider that authored it', () => {
    expect(EXPORT_ROUTE_BY_POSTING_TYPE.provider_sync).toBe('none')
  })

  it('holds `provider_sync` to the same rule as `opening_balance`', () => {
    // Same class of reason (brief 19 §5.1, brief 20 §6): both are OUR record of
    // something the provider already holds, so exporting either doubles it.
    expect(EXPORT_ROUTE_BY_POSTING_TYPE.provider_sync).toBe(
      EXPORT_ROUTE_BY_POSTING_TYPE.opening_balance
    )
  })

  it('is not something a production close emits', () => {
    // `ENABLED_POSTING_TYPES` is what a CLOSE emits. A synced entry is written
    // by the sync, on the accountant's schedule, not by any close - so it does
    // NOT belong here, and adding it would be a claim that a close produces it.
    expect(ENABLED_POSTING_TYPES).not.toContain('provider_sync')
  })

  it('drives no single-writer role, because the accountant codes their own accounts', () => {
    expect(SINGLE_WRITER_ROLES_BY_POSTING_TYPE.provider_sync).toEqual([])
    expect(findWriterConflicts([...ENABLED_POSTING_TYPES, 'provider_sync'])).toEqual([])
  })
})
