// packages/lib/src/field-hooks/pre/purchase-order-status-guard.ts

import { BadRequestError } from '../../errors'
import {
  PURCHASE_ORDER_ACTION_STATUS_MESSAGE,
  PURCHASE_ORDER_ACTION_STATUSES,
  unwrapStatusValue,
} from '../../resources/hooks/lifecycle-status-guard'
import type { FieldPreHookHandler } from '../types'

/** The guarded set as a membership test, built once. */
const GUARDED = new Set<unknown>(PURCHASE_ORDER_ACTION_STATUSES)

/**
 * The manual-`issued` wall for `purchase_order_status`, on the chain that actually runs for
 * client writes (plans/purchasing/07-purchase-order-send-and-status.md §3.4).
 *
 * 🛑 **This is the enforcement point, not the system hook.** `PURCHASE_ORDER_HOOKS`
 * (`resources/hooks/purchasing-hooks.ts`) carries the same guard, but that one runs only on
 * `UnifiedCrudHandler.runPreHooks` — the `record.create`/`record.update` path, the CSV
 * importer and the SDK. Every *interactive* edit of a status field goes through
 * `fieldValue.set` -> `FieldValueService`, which never reads the system-hook registry, so a
 * drawer edit or a kanban drag reaches only THIS handler.
 * `pre/quote-deposit-guard.ts` records the identical finding for `quote_status`. Both guards
 * are kept: together they cover every write path, and each names the other.
 *
 * ⚠️ **The value here is already coerced, and that is the trap.** By the time
 * `fireFieldPreHooks` runs, `validateAndConvertValue` has turned a SINGLE_SELECT write into
 * `{ type: 'option', optionId: 'issued' }` — it is **never** a bare string on this chain. A
 * guard that compared `event.newValue` to `'issued'` directly would be inert: the
 * comparison can never be true, so the guard would pass everything and look exactly like a
 * guard nothing has tripped. `unwrapStatusValue` is shared with the system hook precisely so
 * neither side has to remember which shape it is holding.
 *
 * ✅ **Sanctioned writers get through on `bypassFieldGuards`.** `fireFieldPreHooks`
 * short-circuits on `ctx.bypassFieldGuards.has(systemAttribute)` before this handler is
 * reached, and both sanctioned writers of the `-> issued` transition name
 * `purchase_order_status` there: `markPurchaseOrderSent` (the Send action) and
 * `derivePurchaseOrderStatuses` (§6.1's `draft -> issued` pull-forward when a receipt lands
 * against a draft order). Adding a third writer means adding the same bypass, not weakening
 * this guard.
 *
 * `draft`, `closed` and `canceled` stay freely editable — they are genuine human decisions,
 * and §3.6 deliberately does not derive `closed` so that an order whose remainder has been
 * forgiven is still closeable by hand.
 */
export const guardManualPurchaseOrderIssued: FieldPreHookHandler = async (event) => {
  if (GUARDED.has(unwrapStatusValue(event.newValue))) {
    throw new BadRequestError(PURCHASE_ORDER_ACTION_STATUS_MESSAGE)
  }
  return event.newValue
}
