// packages/lib/src/purchasing/vendor-bill-balance.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import type { EntityFieldChangeHandler } from '../field-hooks/types'
import { createFieldValueContext } from '../field-values/field-value-helpers'
import { setValueWithType } from '../field-values/field-value-mutations'
import { readFieldScalars } from '../field-values/read-field-scalars'
import { toFieldType } from '../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../realtime'
import { defineParentReconciler } from '../reconcilers/parent-reconciler'

const logger = createScopedLogger('purchasing:vendor-bill-balance')

/**
 * `vendor_bill_balance` — what is still owed on a bill, in integer minor units.
 *
 * 🛑 **This module exists because the field had no writer at all.** It shipped
 * declared `creatable: false` / `updatable: false` with the description
 * *"computed as `total - amountPaid`"* and nothing computed it: verified against
 * the dev database on 2026-08-28, the column held **zero `FieldValue` rows in
 * the entire installation**, across 28 organizations and every bill in them. A
 * field nobody can type and nothing derives is permanently NULL, which is the
 * same shape that once shipped NULL order numbers.
 *
 * It stayed invisible because the ONE surface that shows a balance —
 * `vendor-bill-payment-card.tsx` — computes `total - amountPaid` in the browser
 * and never reads the stored field. So the screen was right and the column was
 * empty. What was wrong is everything that trusts the column instead of the
 * card: a filter on Balance, a sort on Balance, and the general-ledger work,
 * which is the consumer that would have been surprised.
 *
 * ## Why this is not in `purchase-order-line-rollups.ts`
 *
 * That file is the four PO-line roll-ups, and every one of them is the same
 * shape: SUM a child entity's rows into a parent, then derive the order's
 * status from the result. The balance shares none of it — no children, no SUM,
 * no order-level pass. It is same-record arithmetic over two transcribed
 * figures, so it lives beside the OTHER writer of the bill's computed fields
 * (`match-hook.ts`, which owns `vendor_bill_status` / `_match_variance` /
 * `_match_notes`).
 *
 * ## The write is derived, not transcribed
 *
 * `total` is keyed from the vendor's document and is never re-derived from the
 * lines (HANDOFF rule 4 — recomputing it would silently correct the vendor's
 * arithmetic, which is the discrepancy the three-way match exists to surface).
 * The balance is the one figure on the bill that IS ours: a subtraction of two
 * facts we already hold.
 */

/** The two inputs. A write to either can move the balance; nothing else can. */
export const VENDOR_BILL_BALANCE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'vendor_bill_total',
  'vendor_bill_amount_paid',
])

const BALANCE_ATTRS = [
  'vendor_bill_total',
  'vendor_bill_amount_paid',
  'vendor_bill_balance',
] as const

/** `dirty-parents` key for the balance. The marked record IS the bill. */
export const VENDOR_BILL_BALANCE_RECONCILER = 'vendor-bill:balance'

/**
 * The balance a bill should be carrying, or `null` when it should carry none.
 *
 * Pure, and exported for the same reason `match.ts` is: the arithmetic is worth
 * testing without a database, and a caller that wants to preview it should not
 * have to write first.
 *
 * - **No total → no balance.** A bill nobody has keyed a total onto owes an
 *   unknown amount, not zero. Storing `0 - paid` there would render an unentered
 *   invoice as fully settled, and a filter on `balance = 0` would collect it.
 * - **No amount paid → the whole total.** An absent payment is a payment of
 *   nothing; that one genuinely is zero.
 * - **Overpayment stays negative.** `Math.max(0, …)` would erase the fact that
 *   the vendor owes us money. The bills card clamps for DISPLAY; the stored
 *   column must not.
 */
export function vendorBillBalance(total: number | null, amountPaid: number | null): number | null {
  if (total === null) return null
  // Both inputs are integer minor units, but they are stored in a double column
  // — round rather than trust float subtraction, because `setValueWithType`
  // rejects a non-integer CURRENCY value outright.
  return Math.round(total - (amountPaid ?? 0))
}

/**
 * Recompute and store one bill's balance.
 *
 * Exported so a caller that needs the balance to reflect its own transaction can
 * run it explicitly after `COMMIT`, and so a one-off backfill can reuse the one
 * implementation rather than restating the arithmetic in SQL.
 *
 * ⚡ Reads the stored balance in the same query as its two inputs and returns
 * before writing when they already agree — the "changes nothing → writes
 * nothing" case. Re-keying a total to the value it already had, or a second
 * attribute landing in a write whose first attribute already triggered the
 * recompute, must not cost a write, a realtime frame and a timeline entry.
 *
 * ⚠️ POST-COMMIT only, like every recompute in this subsystem: with no `db`
 * passed the read runs on the module-level connection and cannot see a caller's
 * open transaction.
 *
 * @returns whether a value was actually written. The reconciler ignores it; a
 * backfill can count from it.
 */
export async function recalculateVendorBillBalance(
  organizationId: string,
  vendorBillInstanceId: string,
  db?: Database
): Promise<boolean> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([...BALANCE_ATTRS])

  const totalField = fields.vendor_bill_total
  const amountPaidField = fields.vendor_bill_amount_paid
  const balanceField = fields.vendor_bill_balance

  if (!totalField || !amountPaidField || !balanceField) {
    logger.warn('Missing custom fields for vendor bill balance', {
      organizationId,
      total: !!totalField,
      amountPaid: !!amountPaidField,
      balance: !!balanceField,
    })
    return false
  }

  const scalars = await readFieldScalars(
    db,
    organizationId,
    [vendorBillInstanceId],
    [totalField.id, amountPaidField.id, balanceField.id]
  )
  const values = scalars.get(vendorBillInstanceId)

  const next = vendorBillBalance(num(values, totalField.id), num(values, amountPaidField.id))
  const stored = num(values, balanceField.id)

  if (stored === next) {
    logger.debug('Vendor bill balance unchanged — nothing written', {
      vendorBillInstanceId,
      balance: next,
    })
    return false
  }

  const billDefId = await requireCachedEntityDefId(organizationId, 'vendor_bill')
  const recordId = toRecordId(billDefId, vendorBillInstanceId) as RecordId

  // The low-level writer, deliberately — the same door
  // `purchase-order-line-rollups.ts` uses. A context with no `userId` does not
  // fire the field-change post-hook chain, which is what keeps a derived write
  // from re-entering the hooks that produced it; the realtime frame the chain
  // would have published is published explicitly below.
  await setValueWithType(createFieldValueContext(organizationId, undefined, db), {
    recordId,
    fieldId: balanceField.id,
    fieldType: toFieldType(balanceField.type),
    value: next === null ? null : { type: 'number', value: next },
  })

  // A cleared value publishes an entry with NO `value`, which is how the clear
  // branch of `setValueWithType` signals it (`field-value-mutations.ts`).
  const entry: FieldValueUpdateEntry =
    next === null
      ? { key: buildFieldValueKey(recordId, balanceField.id as FieldId) }
      : {
          key: buildFieldValueKey(recordId, balanceField.id as FieldId),
          value: { type: 'number', value: next },
        }

  publishFieldValueUpdates(getRealtimeService(), organizationId, [entry]).catch((err) => {
    logger.error('Failed to publish vendor bill balance', {
      vendorBillInstanceId,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  logger.info('Vendor bill balance recalculated', { vendorBillInstanceId, balance: next })
  return true
}

/** A number out of {@link readFieldScalars}' scalar map; anything else reads as absent. */
function num(values: Map<string, unknown> | undefined, fieldId: string): number | null {
  const value = values?.get(fieldId)
  return typeof value === 'number' ? value : null
}

/**
 * Coalescing drain for the balance.
 *
 * The marked record IS the bill, so the spec needs no `resolve`. Coalescing is
 * the whole reason it is here rather than a direct call: `MarkBillPaidDialog`
 * writes six attributes in one `useSaveSystemValues` call, two of which are
 * triggers, and the drawer's own Total edit lands beside a status write. One
 * drain per write scope means one recompute against committed truth, instead of
 * one per changed attribute — and, more importantly, no transient balance
 * computed from a half-applied payment.
 */
const balanceReconciler = defineParentReconciler<string>({
  key: VENDOR_BILL_BALANCE_RECONCILER,
  // The drain wants `Promise<void>`; the recompute reports whether it wrote so a
  // backfill can count. Discarded here rather than widened there.
  rebuild: async (organizationId, _userId, vendorBillInstanceId) => {
    await recalculateVendorBillBalance(organizationId, vendorBillInstanceId)
  },
})

/**
 * Register the balance drain. Called from `registerAllHooks()`.
 *
 * 🛑 Must stay paired with the hook below, which only MARKS. Without this
 * nothing recomputes — which is the exact defect this module exists to close,
 * restored by omission.
 */
export function registerVendorBillBalanceReconcilers(): void {
  balanceReconciler.register()
}

/**
 * Recompute the balance when a bill's total or amount paid is written.
 *
 * **This covers the clear path as well as the set path, and that is why there is
 * no separate delete hook.** `setValueWithType`'s null-delete branch fires the
 * post-hook chain identically to the set branch (`field-value-mutations.ts`
 * §3.6 captures `oldValue` before the branch precisely so it can), so clearing a
 * total arrives here with `newValue: null` and clears the balance with it.
 *
 * There is no bill-line door either, and that is deliberate rather than an
 * omission: a bill's totals are TRANSCRIBED from the vendor's document, never
 * derived from its lines (HANDOFF rule 4 / plan 01 §5.4b), so deleting a bill
 * line cannot move `vendor_bill_total` and therefore cannot move the balance.
 * If that ever stops being true, the balance's inputs changed and this trigger
 * set is what has to change with them.
 *
 * ⚠️ Known gap, shared with the three-way match and both PO-line roll-ups: the
 * sync/import lanes suppress the field-change chain, and
 * `events/handlers/finalize-integrity-passes.ts` runs four hard-coded passes
 * that do not include any purchasing recompute. A bill whose total arrives by
 * connector or CSV gets its balance on the next interactive write. That is a gap
 * in the finalize pass, not in this hook.
 */
export const recalculateBalanceOnBillChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !VENDOR_BILL_BALANCE_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId } = parseRecordId(event.recordId)
  await balanceReconciler.mark(event.organizationId, event.userId, entityInstanceId)
}
