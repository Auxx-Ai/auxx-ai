// packages/lib/src/resources/hooks/lifecycle-status-guard.ts

import { BadRequestError } from '../../errors'
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
export const INVOICE_ACTION_STATUSES = ['sent', 'partially_paid', 'paid', 'void'] as const

/** The one message both invoice lifecycle guards throw. */
export const INVOICE_ACTION_STATUS_MESSAGE =
  'Use the invoice actions (Send / Record payment / Void) to set this status'

/**
 * Reduce a status write to the bare value being set, whatever shape it arrives in.
 *
 * 🛑 The two chains hand a guard **different shapes**, and this is the whole reason the
 * function exists rather than being inlined twice:
 *
 * - On the **system**-hook chain (`UnifiedCrudHandler.runPreHooks`) the value is raw caller
 *   input — usually the bare string, sometimes a single-element array.
 * - On the **field** pre-hook chain (`fireFieldPreHooks`) the value has already been through
 *   `validateAndConvertValue`, so a SINGLE_SELECT arrives as `{ type: 'option', optionId }`
 *   and **never** as a bare string. A guard on that chain that compares the value directly
 *   to `'issued'` is inert: the comparison can never be true, so the guard silently passes
 *   everything.
 *
 * Unwrapping the envelope makes the system-hook side strictly stricter (it now also catches
 * a caller that passes the typed shape), which can only ever reject a write that was trying
 * to set a guarded status.
 *
 * @param raw - The value as the chain handed it over.
 * @returns The scalar the guard should compare against.
 */
export function unwrapStatusValue(raw: unknown): unknown {
  if (Array.isArray(raw)) return unwrapStatusValue(raw[0])
  if (raw && typeof raw === 'object') {
    if ('optionId' in raw) return (raw as { optionId: unknown }).optionId
    if ('value' in raw) return (raw as { value: unknown }).value
  }
  return raw
}

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
