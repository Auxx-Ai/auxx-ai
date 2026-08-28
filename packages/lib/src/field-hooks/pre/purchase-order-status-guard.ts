// packages/lib/src/field-hooks/pre/purchase-order-status-guard.ts

import {
  PURCHASE_ORDER_ACTION_STATUS_MESSAGE,
  PURCHASE_ORDER_ACTION_STATUSES,
} from '../../resources/hooks/lifecycle-status-guard'
import type { FieldPreHookHandler } from '../types'
import { createFieldLifecycleStatusGuard } from './lifecycle-status-guard'

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
 * `quote_status` and `invoice_status` now carry the same pair (`pre/lifecycle-status-guard.ts`),
 * built from the same factory this one uses. Both chains are kept for each: together they
 * cover every write path, and each names the other.
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
export const guardManualPurchaseOrderIssued: FieldPreHookHandler = createFieldLifecycleStatusGuard({
  guardedValues: PURCHASE_ORDER_ACTION_STATUSES,
  message: PURCHASE_ORDER_ACTION_STATUS_MESSAGE,
})
