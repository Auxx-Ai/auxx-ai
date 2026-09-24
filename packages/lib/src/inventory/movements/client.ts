// packages/lib/src/inventory/movements/client.ts

/**
 * Client-safe surface of the movements module: the inventory-ROLE map the write
 * path freezes onto a movement, and the extended-cost arithmetic.
 *
 * **No `'use client'` directive here on purpose.** Server code imports this file
 * too (`values.ts` does), and the directive would turn every export into a
 * client-reference proxy on that side — `docs/lib-module-guide.md` section 7.
 *
 * Nothing here touches `db`, the org cache, the logger, or drizzle.
 */

// `postings/client.ts` is pure data and pure functions - no db, no logger - so
// this stays a client-safe import. `ACCOUNT_ROLES` is the ONLY copy of the role
// vocabulary since decision `G19` retired the `GlAccountRole` registry enum
// along with the `gl_account.role` field it existed to populate.
import { ACCOUNT_ROLES, type AccountRole } from '../../accounting/ledger/client'
import { BadRequestError } from '../../errors'
import { isServicePartKind } from '../costing/client'

/**
 * How a part's classification decides which inventory account a receipt lands in
 * (plans/products/01-product-family.md section 4).
 *
 * ## These are ROLES, not account codes (decision `G8`)
 *
 * This map returned `'1310'` / `'1330'` until the chart of accounts became a
 * seeded **default the org edits** (decision `G7`). Once an org may renumber
 * Raw Materials, a number stamped onto a movement stops meaning anything: the
 * movement is append-only and frozen at write time, so a renumber in 2027
 * silently reinterprets every receipt written in 2026, and the entry still
 * balances so nothing downstream can detect it.
 *
 * A role is stable by construction. The resolution chain is
 * `role -> the org's gl_account -> its code -> the provider's id`, and only the
 * value in the FIRST position is safe to freeze onto a ledger row.
 * `buildInventoryMovementEntry` sums a document's lines by exactly this value.
 *
 * `subassembly` maps to raw materials, NOT to work in process. The build plan's
 * field table names the code space as "`1310` / `1320` / `1330`" but the
 * per-value table in the product-family plan is the one that assigns them, and
 * it puts subassemblies in Raw Materials: work in process is where a part sits
 * *during* a build, not where a purchased subassembly sits on the shelf.
 * Receiving never produces WIP.
 *
 * One map, exported, so the day a part kind moves there is a single place to
 * move it - and so a test can assert the mapping rather than a comment claiming
 * it.
 */
export const INVENTORY_ROLE_BY_PART_KIND: Readonly<Record<string, AccountRole>> = Object.freeze({
  component: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
  subassembly: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
  finished_good: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
})

/** Where an unclassified part's stock is assumed to sit. See {@link resolveInventoryRoleForPartKind}. */
export const DEFAULT_RECEIPT_INVENTORY_ROLE: AccountRole = ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS

/**
 * The inventory account ROLE a receipt of this part should be stamped with.
 *
 * A `service` has no inventory role and throws: it is deliberately absent from the
 * map so it can never fall through to Raw Materials (107-D10).
 *
 * NULL reads as `component`, which is raw materials - and that is the
 * conservative choice on purpose. `partKind` is human-set and unbackfilled, so
 * most parts in an existing org read NULL; defaulting an unclassified part into
 * Raw Materials understates Finished Goods rather than overstating it, and it
 * matches what `readPartKind` already does everywhere else NULL is interpreted.
 *
 * An unrecognised value falls to the same default rather than throwing: a
 * receipt is not the place to discover that somebody added a fourth part kind,
 * and a movement stamped raw materials is correctable while a receipt that
 * failed to write is a pallet nobody counted.
 */
export function resolveInventoryRoleForPartKind(partKind: string | null | undefined): AccountRole {
  if (!partKind) return DEFAULT_RECEIPT_INVENTORY_ROLE
  if (isServicePartKind(partKind)) {
    throw new BadRequestError(
      'A service is not stocked, so it cannot be received, counted, adjusted or built'
    )
  }
  return INVENTORY_ROLE_BY_PART_KIND[partKind] ?? DEFAULT_RECEIPT_INVENTORY_ROLE
}

/**
 * The extended cost of a movement: `round(unitCost x quantity)`.
 *
 * Rounded **after** multiplying, never as a sum of rounded units: rounding first
 * and multiplying scales the rounding error by the quantity, so a half-cent tail
 * on a 10,000-unit receipt becomes $50 of drift against the vendor's invoice.
 *
 * Signed like `quantity` by construction — a receipt is positive, a vendor
 * return is negative, and the subledger sums to the inventory balance because of
 * that and not in spite of it (build plan section 2.1).
 */
export function computeExtendedCost(unitCost: number, quantity: number): number {
  return Math.round(unitCost * quantity)
}
