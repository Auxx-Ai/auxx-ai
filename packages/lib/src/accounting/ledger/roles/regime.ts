// packages/lib/src/accounting/ledger/roles/regime.ts
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

import { ACCOUNT_ROLES, type AccountRole } from '../builders/entry'
import { type ExportRoute, POSTING_POLICIES } from '../post/policy'
import type { PostingType } from '../types'

export type { ExportRoute } from '../post/policy'

/**
 * The posting types a production close may actually emit today.
 *
 * A DERIVED VIEW of {@link POSTING_POLICY} since brief 28 unit 1: every policy
 * with `enabled: true`, in the order the policies are declared, which is the
 * wave order the ledger was switched on in. `__tests__/policy.test.ts` pins
 * that derived list byte for byte to the literal this constant used to hold.
 * To enable a type, flip `enabled` on its policy; do not add a list here.
 *
 * 🛑 **Turning L3 on is ONE change, never two.** Enabling `receipt` and
 * `vendor_bill` while leaving `month_end_inventory` enabled is the exact
 * both-regimes-live state {@link findWriterConflicts} refuses. Swap the
 * contents; do not extend them.
 */
export const ENABLED_POSTING_TYPES: readonly PostingType[] = POSTING_POLICIES.filter(
  (policy) => policy.enabled
).map((policy) => policy.type)

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
 * DECLARED on each type's {@link POSTING_POLICY} record as `singleWriterRoles`,
 * and never derived from the builders. Deriving it would make the assertion
 * tautological - a builder that started emitting an inventory role would simply
 * be reflected here and the check would keep passing. The point is that a human
 * has to come to the policy and say so.
 *
 * Only `month_end_inventory` (all three, the L1 assertion) and `receipt` (raw
 * materials and finished goods, the L3 debit, built and not enabled) declare
 * any. Every other type names its money accounts by id or drives no inventory
 * account at all, so `[]` is what each builder emits, not an exemption. The
 * bank-account gap this guard cannot see is watched by `duplicate-movements.ts`
 * instead - see the header.
 */
export const SINGLE_WRITER_ROLES_BY_POSTING_TYPE: Record<PostingType, readonly AccountRole[]> =
  Object.fromEntries(
    POSTING_POLICIES.map((policy) => [policy.type, policy.singleWriterRoles])
  ) as Record<PostingType, readonly AccountRole[]>

/**
 * How each posting type reaches the connected accounting system.
 *
 * DECLARED on each type's {@link POSTING_POLICY} record as `exportRoute`, never
 * derived from "does a mirror exist for this type". Deriving it would mean that
 * adding a document mirror silently switched a posting type's route, which is
 * the change most likely to double-book, and the check that should have caught
 * it would move with it. A human comes to the policy and says so.
 *
 * plans/accounting/tasks/done/14-one-quickbooks-two-write-paths.md originally scoped
 * a third value, `document` (a document mirror owns the transaction; the entry
 * is built, balanced and persisted, and NOT pushed) for the INVOICE family:
 * `invoice_issued`, `payment`, `credit_memo`, `write_off`. **Retired 2026-09-10 on MK's decision (brief 14's DECIDED
 * block), not as cleanup**: QuickBooks receives journal entries only, and the
 * invoice document mirror (plan 37e) is gone.
 *
 * `postEntry` reads this table (brief 19 §5.1, since 2026-09-10).
 * `opening_balance` and `provider_sync` are the two `'none'` routes today, and
 * both for the same class of reason: an entry that CAME FROM the provider must
 * never be pushed back at it. Every other type still routes `journal`.
 *
 * 🛑🛑 THE LOOP GUARD is `provider_sync: 'none'`. A `provider_sync` entry was
 * authored by the accountant IN the provider and read back off their general
 * ledger; pushing it back is handing them their own entry a second time. Both
 * copies would balance, every statement would still tie, and nothing downstream
 * could detect it. It is declared on the policy, in the record a person has to
 * come to and edit, rather than implied by `providerEntryId` being non-null on
 * the row: a column value on every row is a rule nobody reads, and this one may
 * never quietly become `journal`. `__tests__/regime.test.ts` pins it (brief 20
 * §6).
 */
export const EXPORT_ROUTE_BY_POSTING_TYPE: Record<PostingType, ExportRoute> = Object.fromEntries(
  POSTING_POLICIES.map((policy) => [policy.type, policy.exportRoute])
) as Record<PostingType, ExportRoute>

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
