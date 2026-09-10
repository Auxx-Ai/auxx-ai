// packages/lib/src/postings/regime.ts
//
// PURE. Which posting regime is live, and the roles each posting type may drive.
//
// This file exists for one assertion, and the assertion is the only mechanical
// guard that two writers are not driving one balance-asserted account
// (plans/money/04-books.md §2.2, gap-e risk E5; generalised to `cash` by
// plans/bank-connection/README.md §2.1 and plans/accounting/HANDOFF.md slot 0C,
// and narrowed back to the three inventory accounts by brief 13 §2.5 when
// `cash` retired as a role).
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
// 🛑 `cash` retired as a posting role (brief 13 §2): a bank account is not a
// role, and every cash-touching builder now names a `bank_account`'s own
// `gl_account` id directly, which this guard cannot see by construction (it
// only reads `accountRole` lines). `SINGLE_WRITER_ROLES` is back to exactly the
// three inventory accounts - the guard it can still make mechanically. The gap
// that leaves over bank-account ids is closed by `duplicate-movements.ts`
// (brief 18 §1) reading what was actually POSTED instead - see the note below
// `SINGLE_WRITER_ROLES`.
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
  // plans/accounting/tasks/08 and /07. `invoice_issued` raises the receivable
  // every payment entry already relieved and nothing raised; the deposit
  // application reclasses a held prepayment out of `2350` and onto that
  // receivable. Neither drives a single-writer role, and the two are enabled
  // together because a deposit applied to an invoice with no issuance entry
  // relieves a receivable that was never raised - the same error one document
  // along.
  'invoice_issued',
  'deposit_application',
  // plans/accounting/tasks/10-credit-memos.md. The issue entry reverses revenue
  // through 4090 against the receivable the issuance entry raised. Drives no
  // single-writer role.
  'credit_memo',
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
 * inventory accounts.
 *
 * A manual journal or an opening entry names accounts by CODE and carries no
 * role, so it is invisible to this guard by construction - which is why the
 * manual builder refuses the {@link INVENTORY_ROLES} accounts by name instead:
 * those three are asserted monthly and a hand-keyed line would be reversed by
 * the next close.
 *
 * Closed by brief 18 §1: {@link findDuplicateBankMovements} in
 * `duplicate-movements.ts` answers "is more than one door writing this bank
 * account" over the POSTED LINES themselves - grouped by account, amount,
 * direction and a two-day window - rather than over a declared table of
 * posting types. A single-writer table never arrived because nothing here
 * enumerates every posting type that might touch some bank account the way it
 * enumerates the three inventory roles; reading what was actually posted
 * answers the same question without one, and catches a duplicate a
 * single-writer table could not (two different documents of the same enabled
 * type colliding on one real event).
 */
export const SINGLE_WRITER_ROLES: readonly AccountRole[] = INVENTORY_ROLES

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
  // `Dr <the chosen bank account> Cr undeposited_funds`, one line per bank run.
  // Names the bank account by its own `glAccountId`, never a role (brief 13
  // §2), so this guard cannot see it on the wire at all - `[]` is now exactly
  // what the builder emits, not an exemption. See the header's note on
  // `duplicate-movements.ts`, which is what watches bank accounts instead.
  bank_deposit: [],
  // A matched bank line posts nothing (B5). A CODED line drives the
  // `bank_account`'s own GL account by code, never a role - the bank feed's
  // wave re-plans this entry if that changes.
  bank_transaction: [],
  write_off: [],
  // The `cash` route names a bank account by id (brief 13 §2.4), never a role,
  // so this stays `[]` for the same reason `bank_deposit` above does.
  payment: [],
  // Revenue, receivables and sales tax. No inventory account and no cash: an
  // invoice is issued long before its money arrives, and the payment entry is
  // what moves the money when it does.
  invoice_issued: [],
  // A reclass between two liabilities-and-receivables accounts. No money moves,
  // so nothing here can be a cash or inventory writer.
  deposit_application: [],
  // Returns and allowances, sales tax and the receivable, plus the card
  // clearing account on a channel refund. No inventory account (a `returned`
  // line is recorded, not restocked) and no cash: a native refund is a payment
  // entry, and a channel refund drains through the payout entry.
  credit_memo: [],
  // A synced entry names accounts by the `gl_account` its `providerAccountId`
  // maps to, never a role - it is the accountant's line, not a builder's, so
  // there is no role for this guard to see. `[]` is what the writer emits, not
  // an exemption. And it is not in `ENABLED_POSTING_TYPES` either: that list is
  // what a production CLOSE emits, and nothing about a close writes this type.
  provider_sync: [],
}

/**
 * @deprecated Since slot 0C the map is {@link SINGLE_WRITER_ROLES_BY_POSTING_TYPE}.
 * Kept as an alias so the month-end and regime call sites read unchanged.
 */
export const INVENTORY_ROLES_BY_POSTING_TYPE = SINGLE_WRITER_ROLES_BY_POSTING_TYPE

/**
 * `journal`  auxx composes the entry and pushes it.
 * `none`     nothing is exported for this type at all.
 */
export type ExportRoute = 'journal' | 'none'

/**
 * How each posting type reaches the connected accounting system.
 *
 * DECLARED, never derived from "does a mirror exist for this type". Deriving it
 * would mean that adding a document mirror silently switched a posting type's
 * route, which is the change most likely to double-book, and the check that
 * should have caught it would move with it. A human comes here and says so.
 *
 * plans/accounting/tasks/14-one-quickbooks-two-write-paths.md originally scoped
 * a third value, `document` (a document mirror owns the transaction; the entry
 * is built, balanced and persisted, and NOT pushed) for the INVOICE family:
 * `invoice_issued`, `payment`, `credit_memo`, `deposit_application`,
 * `write_off`. **Retired 2026-09-10 on MK's decision (brief 14's DECIDED
 * block), not as cleanup**: QuickBooks receives journal entries only, and the
 * invoice document mirror (plan 37e) is gone.
 *
 * `postEntry` reads this table (brief 19 §5.1, since 2026-09-10).
 * `opening_balance` and `provider_sync` are the two `'none'` routes today, and
 * both for the same class of reason: an entry that CAME FROM the provider must
 * never be pushed back at it. Every other type still routes `journal`. The table
 * exists so a future second accounting provider (one with no invoice API, say)
 * has a named place to declare the split it would force, rather than that split
 * arriving quietly through a derived check.
 */
export const EXPORT_ROUTE_BY_POSTING_TYPE: Record<PostingType, ExportRoute> = {
  fulfillment: 'journal',
  payout: 'journal',
  build: 'journal',
  month_end_deferral: 'journal',
  month_end_reversal: 'journal',
  month_end_inventory: 'journal',
  receipt: 'journal',
  vendor_bill: 'journal',
  manual_journal: 'journal',
  // An opening balance IS the position the books were in before auxx started
  // posting. If an accounting provider is connected, it is either where those
  // balances came from or the system the firm has been running, and neither
  // case wants them pushed back - a fill sourced from the provider and pushed
  // back would double every balance in it. Brief 19 §5.1, MK's decision (a).
  opening_balance: 'none',
  bank_transaction: 'journal',
  bank_deposit: 'journal',
  write_off: 'journal',
  payment: 'journal',
  invoice_issued: 'journal',
  deposit_application: 'journal',
  credit_memo: 'journal',
  // 🛑🛑 THE LOOP GUARD. A `provider_sync` entry was authored by the accountant
  // IN the provider and read back off their general ledger; pushing it back is
  // handing them their own entry a second time. Both copies would balance, every
  // statement would still tie, and nothing downstream could detect it - brief 19
  // §5.1's failure with the arrows reversed, which is the same reason
  // `opening_balance` above is `'none'`.
  //
  // It is declared HERE, in the table a person has to come to and edit, rather
  // than implied by `providerEntryId` being non-null on the row: a column value
  // on every row is a rule nobody reads, and this one may never quietly become
  // `journal`. `__tests__/regime.test.ts` pins it (brief 20 §6).
  provider_sync: 'none',
}

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
