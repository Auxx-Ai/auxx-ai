// packages/lib/src/accounting/sales/credit-memos/input-wake.ts
//
// The field-side wake of 101 E9: the channel settling a pending refund rewrites
// `credit_memo_money_pending` through the sink, and the memo's parked issue retries now.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import type { FieldChangeRef, MarkHandler } from '../../../field-hooks/types'
import { defineParentReconciler } from '../../../reconcilers/parent-reconciler'
import { wakeSources } from '../../work-items/wake'

const logger = createScopedLogger('credit-memo-input-wake')

export const CREDIT_MEMO_INPUT_WAKE_RECONCILER = 'credit-memo:input-wake'

const reconciler = defineParentReconciler<string>({
  key: CREDIT_MEMO_INPUT_WAKE_RECONCILER,
  rebuildBatch: async (organizationId, _userId, creditMemoInstanceIds) => {
    const woke = await wakeSources(database, organizationId, {
      sourceKind: 'credit_memo',
      sourceIds: creditMemoInstanceIds,
      stage: 'issue',
    })
    if (woke.isErr()) {
      logger.error('memo input wake failed; the rows keep their schedule', { organizationId })
    }
  },
})

/** Register the drain. Called from `registerAllHooks()`. */
export function registerCreditMemoInputWakeReconciler(): void {
  reconciler.register()
}

function isTrue(value: unknown): boolean {
  if (value === true) return true
  return (
    typeof value === 'object' && value !== null && (value as { value?: unknown }).value === true
  )
}

// Values are absent on the sync lane, so only a write known to set the flag stands down.
export const wakeIssueOnMoneyPendingChange: MarkHandler = async (event: FieldChangeRef) => {
  if (event.field.systemAttribute !== 'credit_memo_money_pending') return
  if (isTrue(event.newValue)) return
  const { entityInstanceId } = parseRecordId(event.recordId)
  await reconciler.mark(event.organizationId, event.userId, entityInstanceId)
}
