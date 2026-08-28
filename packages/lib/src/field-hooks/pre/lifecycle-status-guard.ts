// packages/lib/src/field-hooks/pre/lifecycle-status-guard.ts

import { BadRequestError } from '../../errors'
import {
  INVOICE_ACTION_STATUS_MESSAGE,
  INVOICE_ACTION_STATUSES,
  type LifecycleStatusGuardOptions,
  QUOTE_ACTION_STATUS_MESSAGE,
  QUOTE_ACTION_STATUSES,
  unwrapStatusValue,
} from '../../resources/hooks/lifecycle-status-guard'
import type { FieldPreHookHandler } from '../types'

/**
 * Build the "this status is action-set, not a dropdown value" guard for the **field**
 * pre-hook chain (`fireFieldPreHooks`) — the twin of `createLifecycleStatusGuard`, which
 * builds the same rule for the system-hook chain.
 *
 * 🛑 **This chain is the enforcement point; the system one is coverage.** Every *interactive*
 * edit of a status field — the drawer, the grid's inline edit, a kanban drag, a Kopilot
 * record tool — goes through `fieldValue.set` -> `FieldValueService`, which never reads the
 * system-hook registry. A document whose status is guarded only there is guarded on a door
 * nobody uses (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §1). Both are
 * kept: `record.create`/`record.update`, the CSV importer and the SDK take the other one.
 *
 * ⚠️ **The value here is already coerced, and that is the trap this factory exists to close.**
 * By the time this runs, `validateAndConvertValue` has turned a SINGLE_SELECT write into
 * `{ type: 'option', optionId: 'paid' }` — it is **never** a bare string on this chain. A
 * guard comparing `event.newValue` to `'paid'` directly is inert: the comparison can never be
 * true, so it passes everything and is indistinguishable from a guard nothing has tripped. It
 * also reads correctly in review and passes any unit test that feeds it a bare string (§2).
 * `unwrapStatusValue` is shared with the system hook precisely so neither side has to remember
 * which shape it is holding.
 *
 * ✅ **Sanctioned writers get through on `bypassFieldGuards`.** `fireFieldPreHooks`
 * short-circuits on `ctx.bypassFieldGuards.has(systemAttribute)` before any handler is
 * reached, so every action that legitimately produces a guarded value names its attribute
 * there. 🛑 That half is not optional: the moment one of these guards starts working, a
 * sanctioned writer without the bypass is refused by the wall built to protect it, and Send
 * simply stops working (§4).
 *
 * @param options - The guarded value set and the message to throw instead.
 * @returns A {@link FieldPreHookHandler} to register against the status attribute.
 */
export function createFieldLifecycleStatusGuard(
  options: LifecycleStatusGuardOptions
): FieldPreHookHandler {
  // `Set<unknown>`: the incoming value is unknown, and a membership test on an unknown is
  // the `next === 'sent' || …` comparison without a narrowing cast in front of it.
  const guarded = new Set<unknown>(options.guardedValues)

  return async (event) => {
    if (guarded.has(unwrapStatusValue(event.newValue))) {
      throw new BadRequestError(options.message)
    }
    return event.newValue
  }
}

/**
 * The manual-`sent`/`approved` wall for `quote_status` on the chain that actually runs for
 * client writes.
 *
 * Both transitions mirror onto the linked `service_request` — `markQuoteSent` sets it to
 * `quoted`, `approveQuote` to `approved` — and a typed status skips the mirror, leaving the
 * request sitting in the pipeline for a quote that has already been answered.
 *
 * Sanctioned writers, all in `money/quote-lifecycle.ts` and all naming `quote_status` in
 * `bypassFieldGuards`: `markQuoteSent`, `approveQuote` and `declineQuote` (which writes an
 * unguarded value today, and carries the bypass so that stays true of the writer rather than
 * of the value). `acceptQuoteByToken` / `declineQuoteByToken` reach the field through those
 * same two functions.
 *
 * Registered alongside `guardQuoteDraftReturnWithPaidDeposit`, which walls the opposite
 * transition (`-> draft`) and only when a deposit has been paid. The two are disjoint by
 * value; this one runs first because it decides in memory and the deposit wall costs a query.
 */
export const guardManualQuoteLifecycleStatus: FieldPreHookHandler = createFieldLifecycleStatusGuard(
  {
    guardedValues: QUOTE_ACTION_STATUSES,
    message: QUOTE_ACTION_STATUS_MESSAGE,
  }
)

/**
 * The manual-`sent`/`partially_paid`/`paid`/`void` wall for `invoice_status`.
 *
 * 🛑 **This is the one that was corrupting money.** `invoice_status` had no field pre-hook at
 * all — not an inert one, none — so it could be typed to `paid` from the drawer with no
 * `PaymentTransaction`, no allocation and no `invoice_amount_paid`, and the bill read settled
 * (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §3). `sent` skips
 * `markInvoiceSent`'s side effects: `invoice_issued_at` is never stamped and the
 * `WorkOrderBillingInstallment` never flips to `invoiced`.
 *
 * Sanctioned writers, all naming `invoice_status` in `bypassFieldGuards`: `markInvoiceSent`
 * and `voidInvoice` (`money/invoice-lifecycle.ts`), and `syncInvoicePaymentState`
 * (`money/payments/ledger.ts`) — the ledger projection, which is the ONLY writer of `paid`,
 * `partially_paid` and the payment-reversal `-> sent`.
 *
 * ⚠️ Marking an invoice paid by hand is deliberately not possible, and §6.1 of the plan
 * leaves that open: an org reconciling historic invoices may legitimately need it, but the
 * answer there is an action with its own ledger side effects, not an editable dropdown.
 */
export const guardManualInvoiceLifecycleStatus: FieldPreHookHandler =
  createFieldLifecycleStatusGuard({
    guardedValues: INVOICE_ACTION_STATUSES,
    message: INVOICE_ACTION_STATUS_MESSAGE,
  })
