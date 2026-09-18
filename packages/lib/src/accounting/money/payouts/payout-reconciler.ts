// packages/lib/src/accounting/money/payouts/payout-reconciler.ts

/**
 * The payout assessment as a dirty-parent reconciler
 * (`plans/events/08-derived-parent-reconciler-plan.md`; LIB-LAYOUT §3f).
 *
 * The degenerate case of the primitive: a marked `payout` or
 * `processor_balance_entry` IS the parent, so there is no `resolve` —
 * `assessPayouts` does its own owner resolution from those ids and then assesses
 * each canonical `MoneyTransfer` once, which is per-batch work the drain must not
 * split up. Hence `rebuildBatch` rather than `rebuild`.
 */

import { database } from '@auxx/database'
import { defineParentReconciler } from '../../../reconcilers/parent-reconciler'
import { assessPayouts } from './assess-payouts'

export const PAYOUT_ASSESSMENT = 'money.payout-assessment'

const reconciler = defineParentReconciler<string>({
  key: PAYOUT_ASSESSMENT,
  rebuildBatch: async (organizationId, _userId, entityInstanceIds) => {
    await assessPayouts(database, organizationId, entityInstanceIds)
  },
})

/** Register the drain. Idempotent per key. */
export function registerPayoutReconciler(): void {
  reconciler.register()
}

/**
 * Mark a payout owner for assessment, or assess now when nothing will drain (see
 * `ParentReconciler.mark` for why that fallback is load-bearing).
 */
export const markPayoutForAssessment = reconciler.mark
