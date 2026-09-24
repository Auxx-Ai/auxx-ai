// packages/lib/src/field-hooks/__tests__/reconciler-pairing.test.ts
//
// plans/events/10 §7 item 5: a mark into an unregistered reconciler key is dropped in
// silence — `markOrRecomputeDocument`'s optional chain swallowed every `vendor_credit`
// mark for exactly that reason. So every key a registered hook can mark is asserted to
// have a drain after the real `registerAllHooks()` runs.

import { beforeAll, describe, expect, it, vi } from 'vitest'

const registeredKeys = vi.hoisted(() => new Set<string>())

// The read seam: `dirty-parents` owns the drain map and exposes no probe, so the keys are
// collected off the registration call instead.
vi.mock('../../reconcilers/dirty-parents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../reconcilers/dirty-parents')>()
  return {
    ...actual,
    registerReconciler: (key: string, drain: Parameters<typeof actual.registerReconciler>[1]) => {
      registeredKeys.add(key)
      actual.registerReconciler(key, drain)
    },
  }
})

import {
  CREDIT_MEMO_ACCEPTANCE_WAKE_RECONCILER,
  ORDER_ACCEPTANCE_WAKE_RECONCILER,
} from '../../accounting/money/customer-money/acceptance-wake'
import { ORDER_PAYMENT_EVIDENCE } from '../../accounting/money/customer-money/order-evidence-reconciler'
import { PAYOUT_ASSESSMENT } from '../../accounting/money/payouts/payout-reconciler'
import {
  MATCH_VENDOR_BILL,
  MATCH_VENDOR_BILL_LINE,
} from '../../accounting/purchasing/match-reconciler'
import { VENDOR_BILL_BALANCE_RECONCILER } from '../../accounting/purchasing/vendor-bill-balance'
import {
  BILLING_CONTACT,
  BILLING_INVOICE,
  BILLING_LINE_ITEM,
  BILLING_WORK_ORDER,
} from '../../accounting/sales/billing/reconciler'
import {
  FULFILLMENT_LINE_ORDER_TOTALS_RECONCILER,
  FULFILLMENT_ORDER_TOTALS_RECONCILER,
} from '../../accounting/sales/fulfillments/totals-reconciler'
import {
  MONEY_TOTALS_LINE_ITEM,
  MONEY_TOTALS_PURCHASE_ORDER_LINE,
  moneyTotalsDocumentKey,
} from '../../accounting/sales/totals/totals-reconciler'
import { ORDER_DRIFT_LINE, ORDER_DRIFT_ORDER } from '../../inventory/builds/drift-reconciler'
import { PURCHASE_ORDER_LINE_BILLED_ROLLUP } from '../post/purchase-order-line-rollups'
import { registerAllHooks } from '../register-hooks'

/**
 * Every key reachable from a hook registered in `registerAllHooks()`, named by the handler
 * that marks it. Keep it in step with the `key:` of each `defineParentReconciler` spec a
 * mark or a derive can reach.
 */
const MARKED_KEYS: Record<string, string> = {
  'recomputeOnLineChange (derive)': MONEY_TOTALS_LINE_ITEM,
  'recomputeOnPurchaseOrderLineChange (derive)': MONEY_TOTALS_PURCHASE_ORDER_LINE,
  recomputeOnQuoteBillingChange: moneyTotalsDocumentKey('quote'),
  recomputeOnInvoiceBillingChange: moneyTotalsDocumentKey('invoice'),
  recomputeOnOrderBillingChange: moneyTotalsDocumentKey('order'),
  recomputeOnPurchaseOrderBillingChange: moneyTotalsDocumentKey('purchase_order'),
  'recomputeOnCreditMemoLineChange (derive)': moneyTotalsDocumentKey('credit_memo'),
  'recomputeOnVendorCreditLineChange (derive)': moneyTotalsDocumentKey('vendor_credit'),
  syncBillingOnLineChange: BILLING_LINE_ITEM,
  syncBillingOnWorkOrderChange: BILLING_WORK_ORDER,
  syncBillingOnInvoiceChange: BILLING_INVOICE,
  'syncContactAfterWorkOrderDelete (post-delete)': BILLING_CONTACT,
  rematchOnBillChange: MATCH_VENDOR_BILL,
  rematchOnBillLineChange: MATCH_VENDOR_BILL_LINE,
  recalculateBalanceOnBillChange: VENDOR_BILL_BALANCE_RECONCILER,
  'recalculateBilledRollupOn*Change': PURCHASE_ORDER_LINE_BILLED_ROLLUP,
  stampOrderOnOrderChange: ORDER_DRIFT_ORDER,
  stampOrderOnLineChange: ORDER_DRIFT_LINE,
  stampTotalsOnFulfillmentChange: FULFILLMENT_ORDER_TOTALS_RECONCILER,
  stampTotalsOnFulfillmentLineChange: FULFILLMENT_LINE_ORDER_TOTALS_RECONCILER,
  wakeAcceptancesOnOrderChange: ORDER_ACCEPTANCE_WAKE_RECONCILER,
  wakeAcceptancesOnCreditMemoChange: CREDIT_MEMO_ACCEPTANCE_WAKE_RECONCILER,
  'markEvidenceOn*Change': ORDER_PAYMENT_EVIDENCE,
  'assessOn*Change': PAYOUT_ASSESSMENT,
}

beforeAll(() => {
  registerAllHooks()
})

describe('reconciler pairing (plans/events/10 §7 item 5)', () => {
  it('registers a drain for every key a registered hook can mark', () => {
    const missing = Object.entries(MARKED_KEYS)
      .filter(([, key]) => !registeredKeys.has(key))
      .map(([handler, key]) => `${handler} -> ${key}`)

    expect(missing).toEqual([])
  })
})
