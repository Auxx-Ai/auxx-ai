// packages/lib/src/resources/hooks/lifecycle-status-guard.ts

import { BadRequestError } from '../../errors'
import { unwrapStatusValue } from '../events/captured-values'
import type { SystemHook } from './types'

/**
 * The `purchase_order_status` values an ACTION owns. Exported so the two guards that
 * enforce it — the system pre-hook in `purchasing-hooks.ts` and the field pre-hook in
 * `field-hooks/pre/purchase-order-status-guard.ts` — read ONE source and cannot drift into
 * disagreeing about what is guarded.
 *
 * `draft`, `closed` and `canceled` are deliberately absent: they are genuine human
 * decisions, and §3.6 does not derive `closed` precisely so that an order whose remainder
 * has been forgiven stays closeable by hand.
 */
export const PURCHASE_ORDER_ACTION_STATUSES = ['issued'] as const

/** The one message both purchase-order guards throw, for the same reason as the set above. */
export const PURCHASE_ORDER_ACTION_STATUS_MESSAGE = 'Use Send to issue this purchase order'

/**
 * The `quote_status` values an ACTION owns (money MQ1 build spec §F.3). Same one-source rule
 * as the purchase order's set above: the system pre-hook in `quote-hooks.ts` and the field
 * pre-hook in `field-hooks/pre/lifecycle-status-guard.ts` both read this, so the two chains
 * cannot drift into guarding different values.
 *
 * `draft`, `declined` and `canceled` stay freely editable. `declined` has a sanctioned writer
 * (`declineQuote`) but no side effects a manual write would skip, and the edit-a-sent-quote
 * flow writes plain `draft` after a `useConfirm` — that transition is walled separately, and
 * only when money is at stake, by `pre/quote-deposit-guard.ts`.
 */
export const QUOTE_ACTION_STATUSES = ['sent', 'approved'] as const

/** The one message both quote lifecycle guards throw. */
export const QUOTE_ACTION_STATUS_MESSAGE =
  'Use the quote actions (Send / Mark approved) to set this status'

/**
 * The `invoice_status` values an ACTION owns (money MI1 build spec §F.2).
 *
 * 🛑 `paid` and `partially_paid` are in here for a different and sharper reason than `sent`.
 * They are LEDGER-DERIVED: `syncInvoicePaymentState` computes them from the
 * `PaymentTransaction` rows and nothing else. A hand-set `paid` therefore records a settled
 * bill with no payment behind it — no transaction, no allocation, no `invoice_amount_paid` —
 * and every downstream read believes it. That is the one case in this file where an inert
 * guard silently corrupts money rather than merely skipping a mirror
 * (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §3).
 *
 * `draft` stays editable: both the edit-a-sent-invoice flow and un-voiding write it directly
 * after a confirmation.
 */
// `written_off` added by plans/accounting/HANDOFF.md slot 2K: `writeOffInvoice`
// (`money/invoices/write-off.ts`) is the one sanctioned writer, naming
// `invoice_status` in `bypassFieldGuards` the same way `voidInvoice` does -
// without it here, a drawer edit could type "Written off" with none of that
// action's ledger posting or balance effects, the exact bug this wall exists
// to close (see the guard's own comment below).
export const INVOICE_ACTION_STATUSES = [
  'sent',
  'partially_paid',
  'paid',
  'void',
  'written_off',
] as const

/** The one message both invoice lifecycle guards throw. */
export const INVOICE_ACTION_STATUS_MESSAGE =
  'Use the invoice actions (Send / Record payment / Void / Write off) to set this status'

/**
 * Reduce a status write to the bare value being set, whatever shape it arrives in.
 *
 * 🛑 **Moved to `resources/events/captured-values.ts`** and re-exported here so the callers
 * that already import it from this path keep working. It moved because a THIRD chain — the
 * `captureEventData` capture that feeds pre-delete hooks, post-delete hooks and the lifecycle
 * event — hands over yet another shape, and keeping the unwrapper next to the function that
 * produces the shapes is what stops a fourth private copy being written
 * (`plans/money/tasks/24-captured-value-shape.md`). The three-chain table lives on the
 * definition.
 */
export { unwrapStatusValue }

/** Options for {@link createLifecycleStatusGuard}. */
export interface LifecycleStatusGuardOptions {
  /**
   * The status values an ACTION owns. A manual write to any of them is refused;
   * everything else on the enum stays freely editable.
   */
  guardedValues: readonly string[]
  /**
   * What to tell the caller instead. Name the actions, not the rule — the person
   * seeing this wants to know which button to press.
   */
  message: string
}

/**
 * Build the "this status is action-set, not a dropdown value" guard for the **system**-hook
 * chain (`UnifiedCrudHandler.runPreHooks`).
 *
 * Three documents now need the identical logic and differ only in which values an action
 * owns and what to say instead: `quote_status` (Send / Mark approved), `invoice_status`
 * (Send / Record payment / Void) and `purchase_order_status` (Send). The two copies that
 * existed verbatim in `quote-hooks.ts` and `invoice-hooks.ts` are now both this function
 * (plans/purchasing/07-purchase-order-send-and-status.md §3.4).
 *
 * ⚠️ **Which chain this covers, and which it does not.** This runs only for writes through
 * `UnifiedCrudHandler.create`/`.update` — `record.create`, `record.update`, bulk record
 * writes, the CSV importer and the SDK. It does **not** run for `fieldValue.set` /
 * `setBulk`, which is how the drawer, the grid's inline edit, a kanban drag and the
 * LineBuilder all write. `field-hooks/pre/quote-deposit-guard.ts` records the same finding
 * independently. So a status that must be genuinely un-typeable needs a **field** pre-hook
 * twin as well; `purchase_order_status` has one in
 * `field-hooks/pre/purchase-order-status-guard.ts`, and the two share their guarded set and
 * message through the constants at the top of this file.
 *
 * The sanctioned writers reach the field through `FieldValueService`, which bypasses this
 * chain entirely, so this guard never sees their writes — it only ever sees a human typing
 * a value an action is supposed to produce.
 *
 * ⚠️ Two behaviours here are load-bearing and are preserved from the originals:
 *
 * 1. `operation === 'create'` returns early. A create cannot legitimately start in a guarded
 *    state — every one of these fields has `defaultValue: 'draft'` — and running the check on
 *    create would refuse a create that merely echoed the default back.
 * 2. The incoming value may be keyed by `field.id` OR by `field.systemAttribute`, and may
 *    arrive scalar or as a single-element array (SINGLE_SELECT).
 *    `UnifiedCrudHandler.runPreHooks` deliberately checks both keys before dispatching, so a
 *    guard that read only one of them would be silently bypassed by half the callers.
 *
 * @param options - The guarded value set and the message to throw instead.
 * @returns A {@link SystemHook} to register against the status attribute.
 */
export function createLifecycleStatusGuard(options: LifecycleStatusGuardOptions): SystemHook {
  // `Set<unknown>` rather than `Set<string>`: the incoming value is unknown, and a
  // membership test on an unknown is exactly the original `next === 'sent' || …`
  // comparison without a narrowing cast in front of it.
  const guarded = new Set<unknown>(options.guardedValues)

  return async ({ operation, field, values }) => {
    if (operation === 'create') return values // creates can't start guarded (defaultValue 'draft')
    // Update values may be keyed by fieldId or systemAttribute, scalar or single-element array.
    const raw = field.id in values ? values[field.id] : values[field.systemAttribute ?? '']
    if (guarded.has(unwrapStatusValue(raw))) {
      throw new BadRequestError(options.message)
    }
    return values
  }
}
