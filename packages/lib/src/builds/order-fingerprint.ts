// packages/lib/src/builds/order-fingerprint.ts

/**
 * The order's production demand, reduced to one comparable string.
 *
 * `plans/products/13-order-build-reconciliation.md` Model A+. An order stays
 * editable by design and the auto-build trigger fires once, on `created` — so a
 * build says 3 forever while the order says 5 and no screen anywhere says they
 * disagree (13 §0). This is what makes that disagreement visible: the order
 * carries its CURRENT fingerprint, a build carries the one that was current when
 * it was raised, and drift is simply the two differing.
 *
 * 🛑 **This decides nothing and changes nothing.** It does not create, amend or
 * cancel a build. That is the point of A+ over Model B — plan 13 Q1 (snapshot or
 * projection?) stays open, and whoever answers it inherits a convergence check
 * that is already computed and stored.
 *
 * ## What goes in, and why it is the collapsed view
 *
 * The demand, not the document: {@link sumQuantityByPart}, which is the very
 * function the trigger raises builds from (12 §5.3 step 6, *"one build per part,
 * not one per line"*). Sharing it is deliberate — a fingerprint derived from a
 * second, parallel reading of the order could disagree with what auto-build
 * would actually raise, and a drift signal that lies is worse than none.
 *
 * Three consequences, all intended:
 *
 * - **Splitting one line of 5 into 2 + 3 is NOT drift.** Production is asked for
 *   the same five units. The document changed; the demand did not.
 * - **A line that reaches no part contributes nothing**, because it asks
 *   production for nothing — `loadAutoBuildOrders` has already dropped it.
 * - **A non-positive or non-finite quantity contributes nothing**, and a part
 *   whose lines sum to zero drops out entirely, exactly as it does at raise time.
 *
 * ## Cancellation
 *
 * Carried as a BOOLEAN, not the timestamp. A cancelled order asks production for
 * nothing, so its fingerprint must differ from its live self — but re-stamping
 * `order_cancelled_at` with a different time is not a change in demand, and
 * hashing the instant would report drift for it.
 */

import { stableHash } from '@auxx/utils/hash'
import { type AutoBuildLine, sumQuantityByPart } from './auto-build-policy'

/** Everything the fingerprint is allowed to see. No db, no clock. */
export interface OrderDemand {
  /** `order_cancelled_at`. Non-null means the order is cancelled. */
  cancelledAt: Date | null
  /** The order's live lines that reach a part. */
  lines: readonly AutoBuildLine[]
}

/**
 * The order's demand fingerprint — a hex SHA-256, stable across runs, processes
 * and a Postgres `jsonb` round-trip.
 *
 * ⚠️ Sorted explicitly before hashing. {@link stableHash} is key-order
 * independent but preserves ARRAY order on purpose (`packages/utils/src/json.ts`
 * — array order is usually meaningful), and here it is not: the same two lines
 * read back in a different order must produce the same fingerprint or every
 * reconcile would report drift that does not exist.
 */
export function orderDemandFingerprint(demand: OrderDemand): string {
  const totals = sumQuantityByPart(demand.lines)
  const parts = [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return stableHash({
    cancelled: demand.cancelledAt !== null,
    parts,
  })
}

/**
 * Has this build drifted from the order that raised it?
 *
 * `false` whenever the comparison cannot be made — a build with no stamp (raised
 * by hand, or before this shipped) and an order with no fingerprint yet are both
 * *unknown*, not *drifted*. Reporting drift for an absent value would light up
 * every historical build at once and teach everyone to ignore the signal.
 */
export function hasDrifted(
  buildOrderRevision: string | null | undefined,
  orderBuildRevision: string | null | undefined
): boolean {
  if (!buildOrderRevision || !orderBuildRevision) return false
  return buildOrderRevision !== orderBuildRevision
}
