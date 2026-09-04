// packages/lib/src/postings/regime.ts
//
// PURE. Which posting regime is live, and the roles each posting type may drive.
//
// This file exists for one assertion, and the assertion is the only mechanical
// guard that two writers are not driving one balance-asserted account
// (plans/money/04-books.md §2.2, gap-e risk E5; generalised to `cash` by
// plans/bank-connection/README.md §2.1 and plans/accounting/HANDOFF.md slot 0C).
//
// ── The failure it prevents ─────────────────────────────────────────────────
//
// `1310` / `1320` / `1330` may be driven by a monthly balance ASSERTION or by
// per-event postings, never both. The two are not additive and the conflict is
// undetectable downstream: the month-end entry moves each inventory account TO
// the value the subledger computes, so it would silently reverse every perpetual
// posting made during the month and dump the residual into the COGS plug, where
// it reads exactly like consumption. Both entries balance. Both claim cleanly.
// Nothing in the engine can tell the difference.
//
// `cash` has the same shape one level over. A bank deposit that posts
// `Dr cash Cr undeposited_funds` and a bank-feed line that posts the SAME
// deposit again as `Dr cash Cr something` both balance, and the cash account is
// overstated by the deposit with nothing to flag it. So `cash` has ONE
// role-emitting writer, `bank_deposit`; a matched bank line links and posts
// nothing (bank plan decision B5).
//
// `receipt` and `vendor_bill` are present in `POSTING_TYPES` and in the pgEnum,
// and `buildReceiptEntry` / `buildVendorBillEntry` are written and tested - they
// are the L3 regime, deliberately built ahead and deliberately not enabled. So
// the union does not tell you what is live, and neither does the existence of a
// builder. This constant does.

import { ACCOUNT_ROLES, type AccountRole } from './build-entry'
import type { PostingType } from './types'

/**
 * The posting types a production close may actually emit today.
 *
 * 🛑 **Turning L3 on is ONE change, never two.** Adding `receipt` and
 * `vendor_bill` here while leaving `month_end_inventory` is the exact
 * both-regimes-live state {@link findWriterConflicts} refuses. Swap the
 * contents; do not extend them.
 *
 * The wave-1 types (`manual_journal`, `opening_balance`, `bank_deposit`) and
 * the wave-2 ones (`fulfillment`, `payout`, `write_off`) are flipped on here by
 * the coordinator once their slots are driven, per the handoff §9.
 */
export const ENABLED_POSTING_TYPES: readonly PostingType[] = [
  'month_end_inventory',
  // Wave 1, flipped 2026-09-04 once every slot was driven (HANDOFF §9).
  'manual_journal',
  'opening_balance',
  'bank_deposit',
  // Wave 2. `fulfillment` posts the revenue legs only; its COGS leg stays dark
  // under L1 and is the L3 switch. `payout` has a builder and no trigger yet.
  'fulfillment',
  'payment',
  'payout',
  'write_off',
  // Wave 3. A CODED bank line posts by account code against the bank account's
  // own GL code; a matched line posts nothing (bank plan B5).
  'bank_transaction',
  // `receipt` and `vendor_bill` are the L3 buy side and wait for the same
  // switch as the COGS leg.
]

/** The three inventory accounts that may only ever have one writer. */
export const INVENTORY_ROLES: readonly AccountRole[] = [
  ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
  ACCOUNT_ROLES.INVENTORY_WIP,
  ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
]

/**
 * Every role that may have at most ONE enabled role-emitting writer: the three
 * inventory accounts, and `cash`.
 *
 * A manual journal or an opening entry names accounts by CODE and carries no
 * role, so it is invisible to this guard by construction. That is deliberate
 * for `cash` (an opening bank balance IS a manual cash line) and is why the
 * manual builder refuses the {@link INVENTORY_ROLES} accounts by name instead:
 * those three are asserted monthly and a hand-keyed line would be reversed by
 * the next close.
 */
export const SINGLE_WRITER_ROLES: readonly AccountRole[] = [...INVENTORY_ROLES, ACCOUNT_ROLES.CASH]

/**
 * Which single-writer roles each posting type can put on a line.
 *
 * DECLARED, not derived from the builders. Deriving it would make the assertion
 * tautological - a builder that started emitting an inventory role would simply
 * be reflected here and the check would keep passing. The point is that a human
 * has to come to this file and say so.
 */
export const SINGLE_WRITER_ROLES_BY_POSTING_TYPE: Record<PostingType, readonly AccountRole[]> = {
  // Asserts all three to the subledger's computed balance. The L1 regime.
  month_end_inventory: INVENTORY_ROLES,
  // L3. `buildReceiptEntry` debits raw materials or finished goods at landed
  // cost - built, tested, and not enabled.
  receipt: [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS],
  // L3. Moves GRNI to A/P with a PPV residual; touches no inventory account.
  vendor_bill: [],
  // Revenue legs only while the COGS leg is dark. When the leg turns on this
  // becomes `[INVENTORY_FINISHED_GOODS]`, in the SAME change that swaps
  // `month_end_inventory` out of `ENABLED_POSTING_TYPES`.
  fulfillment: [],
  payout: [],
  build: [],
  month_end_deferral: [],
  month_end_reversal: [],
  // Code-based entries: no role on any line, so nothing to declare. The
  // inventory refusal for these two lives in the manual builder, by name.
  manual_journal: [],
  opening_balance: [],
  // The ONE cash writer: `Dr <the chosen bank account> Cr undeposited_funds`,
  // one line per bank run.
  //
  // ⚠️ Since the deposit learned to bank into a NAMED account, its debit is a
  // CODE line carrying the `bank_account`'s own GL code, not the `cash` role,
  // so `findWriterConflicts` cannot see it on the wire. `[CASH]` stays anyway,
  // and is not vacuous: this map is DECLARED, never derived (see its header).
  // The declaration is a human saying "this type drives cash", which is what
  // makes the guard bite the day a SECOND type says the same thing. Emptying it
  // to match what the builder now emits would turn the check tautological in
  // exactly the way the header warns against, and would silently drop cash's
  // only protection.
  bank_deposit: [ACCOUNT_ROLES.CASH],
  // A matched bank line posts nothing (B5). A CODED line drives the
  // `bank_account`'s own GL account by code, never the `cash` role - the bank
  // feed's wave re-plans this entry if that changes.
  bank_transaction: [],
  write_off: [],
  // Drives cash ONLY on the `cash` payment route (an ACH or wire that arrives
  // at the bank alone), chosen per method in `accounting.paymentRoute.*`. The
  // same money never also passes through `bank_deposit` (that is the
  // `undeposited_funds` route), and a bank-feed line that matches a payment
  // posts nothing (bank plan B5), so there is no second writer of the same
  // event. Declared `[]` because this guard is per TYPE, not per route, and
  // `[CASH]` here beside `bank_deposit` would flag a conflict that is not one.
  // If the guard ever becomes route-aware, this is the entry to revisit.
  payment: [],
}

/**
 * @deprecated Since slot 0C the map is {@link SINGLE_WRITER_ROLES_BY_POSTING_TYPE}.
 * Kept as an alias so the month-end and regime call sites read unchanged.
 */
export const INVENTORY_ROLES_BY_POSTING_TYPE = SINGLE_WRITER_ROLES_BY_POSTING_TYPE

/** One posting type paired with the single-writer roles it would drive. */
export interface WriterConflict {
  role: AccountRole
  postingTypes: PostingType[]
}

/** @deprecated Renamed {@link WriterConflict} in slot 0C. */
export type InventoryWriterConflict = WriterConflict

/**
 * Every single-writer role that more than one ENABLED posting type would drive.
 *
 * Empty is the healthy answer. A non-empty result means the ledger is running
 * two regimes at once and an asserted account is being both accumulated and
 * asserted, or cash is being written from two doors.
 */
export function findWriterConflicts(
  enabled: readonly PostingType[] = ENABLED_POSTING_TYPES
): WriterConflict[] {
  return SINGLE_WRITER_ROLES.flatMap((role) => {
    const writers = enabled.filter((type) =>
      SINGLE_WRITER_ROLES_BY_POSTING_TYPE[type].includes(role)
    )
    return writers.length > 1 ? [{ role, postingTypes: writers }] : []
  })
}

/** @deprecated Renamed {@link findWriterConflicts} in slot 0C. Same function. */
export const findInventoryWriterConflicts = findWriterConflicts
