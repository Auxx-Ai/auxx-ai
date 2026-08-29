// packages/lib/src/postings/regime.ts
//
// PURE. Which posting regime is live, and the roles each posting type may drive.
//
// This file exists for one assertion, and the assertion is the only mechanical
// guard that L1 and L3 are not both running (plans/money/04-books.md §2.2,
// gap-e risk E5).
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
 * both-regimes-live state {@link assertSingleInventoryWriter} refuses. Swap the
 * contents; do not extend them.
 */
export const ENABLED_POSTING_TYPES: readonly PostingType[] = ['month_end_inventory']

/** The three accounts that may only ever have one writer. */
export const INVENTORY_ROLES: readonly AccountRole[] = [
  ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
  ACCOUNT_ROLES.INVENTORY_WIP,
  ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
]

/**
 * Which inventory roles each posting type can put on a line.
 *
 * DECLARED, not derived from the builders. Deriving it would make the assertion
 * tautological - a builder that started emitting an inventory role would simply
 * be reflected here and the check would keep passing. The point is that a human
 * has to come to this file and say so.
 */
export const INVENTORY_ROLES_BY_POSTING_TYPE: Record<PostingType, readonly AccountRole[]> = {
  // Asserts all three to the subledger's computed balance. The L1 regime.
  month_end_inventory: INVENTORY_ROLES,
  // L3. `buildReceiptEntry` debits raw materials or finished goods at landed
  // cost - built, tested, and not enabled.
  receipt: [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS],
  // L3. Moves GRNI to A/P with a PPV residual; touches no inventory account.
  vendor_bill: [],
  fulfillment: [],
  payout: [],
  build: [],
  month_end_deferral: [],
  month_end_reversal: [],
}

/** One posting type paired with the inventory roles it would drive. */
export interface InventoryWriterConflict {
  role: AccountRole
  postingTypes: PostingType[]
}

/**
 * Every inventory role that more than one ENABLED posting type would drive.
 *
 * Empty is the healthy answer. A non-empty result means the ledger is running
 * two regimes at once and the inventory accounts are being both accumulated and
 * asserted.
 */
export function findInventoryWriterConflicts(
  enabled: readonly PostingType[] = ENABLED_POSTING_TYPES
): InventoryWriterConflict[] {
  return INVENTORY_ROLES.flatMap((role) => {
    const writers = enabled.filter((type) => INVENTORY_ROLES_BY_POSTING_TYPE[type].includes(role))
    return writers.length > 1 ? [{ role, postingTypes: writers }] : []
  })
}
