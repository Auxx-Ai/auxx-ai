// packages/lib/src/purchasing/match-reconciler.ts

/**
 * The three-way match as a dirty-parent reconciler
 * (`plans/events/08-derived-parent-reconciler-plan.md`, the money engine's twin).
 *
 * `rematchOnBillLineChange` fires on four attributes, once per changed field, and
 * each fire re-matched the whole bill. Entering a 10-line bill was ~30 matches.
 * Now each fire marks and the drain matches once.
 *
 * Two keys, for the same reason the money reconciler has six: the drain has to
 * know whether it was handed a bill or one of its lines.
 */

import { getOrgCache } from '../cache'
import { readFieldRelations } from '../field-values/read-field-scalars'
import { markParentDirty, registerReconciler } from '../reconcilers/dirty-parents'

export const MATCH_VENDOR_BILL = 'three-way-match:vendor_bill'
export const MATCH_VENDOR_BILL_LINE = 'three-way-match:vendor_bill_line'

let registered = false

/** Register both drains. Called from `registerAllHooks()`, idempotent. */
export function registerMatchReconcilers(): void {
  if (registered) return
  registered = true

  registerReconciler(MATCH_VENDOR_BILL, async ({ organizationId, userId, parentInstanceIds }) => {
    await rematchEach(organizationId, userId, parentInstanceIds)
  })

  registerReconciler(
    MATCH_VENDOR_BILL_LINE,
    async ({ organizationId, userId, parentInstanceIds }) => {
      const bills = await resolveBillsForLines(organizationId, parentInstanceIds)
      await rematchEach(organizationId, userId, bills)
    }
  )
}

/**
 * Match each distinct bill once, isolating failures.
 *
 * One bill failing must not lose the rest: a drain batch is several unrelated
 * documents, not one unit of work. `rematchBill` is lazy-imported so this module
 * carries no runtime edge back to `match-hook`, which imports it.
 */
async function rematchEach(
  organizationId: string,
  userId: string,
  vendorBillInstanceIds: string[]
): Promise<void> {
  if (vendorBillInstanceIds.length === 0) return
  const { rematchBill } = await import('./match-hook')

  for (const vendorBillInstanceId of new Set(vendorBillInstanceIds)) {
    await rematchBill({ organizationId, userId, vendorBillInstanceId })
  }
}

/**
 * The bill each line hangs off, in ONE query.
 *
 * The per-line version was a `getFieldValues` per line, called once per changed
 * attribute — four round trips for one line whose quantity, price and PO link all
 * moved in the same write.
 */
async function resolveBillsForLines(
  organizationId: string,
  lineInstanceIds: string[]
): Promise<string[]> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['vendor_bill_line_vendor_bill'] as const)
  const relField = cf.vendor_bill_line_vendor_bill
  if (!relField) return []

  const rels = await readFieldRelations(undefined, organizationId, lineInstanceIds, [relField.id])

  const bills: string[] = []
  for (const lineInstanceId of lineInstanceIds) {
    const bill = rels.get(lineInstanceId)?.get(relField.id)
    if (bill) bills.push(bill)
  }
  return bills
}

/**
 * Mark a bill for rematch, or rematch it now when nothing will drain.
 *
 * The inline fallback is load-bearing — see `markParentDirty`: a caller that
 * reached the hook chain through an exported `field-value-mutations` function
 * rather than a public service method has no scope, and without this the bill
 * would silently stop leaving the exception queue.
 */
export async function markOrRematchBill(
  organizationId: string,
  userId: string,
  vendorBillInstanceId: string
): Promise<void> {
  if (markParentDirty(MATCH_VENDOR_BILL, vendorBillInstanceId)) return
  await rematchEach(organizationId, userId, [vendorBillInstanceId])
}

/** {@link markOrRematchBill}'s line-side twin. */
export async function markOrRematchBillLine(
  organizationId: string,
  userId: string,
  lineInstanceId: string
): Promise<void> {
  if (markParentDirty(MATCH_VENDOR_BILL_LINE, lineInstanceId)) return
  const bills = await resolveBillsForLines(organizationId, [lineInstanceId])
  await rematchEach(organizationId, userId, bills)
}
