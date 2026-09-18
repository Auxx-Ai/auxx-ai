// packages/lib/src/purchasing/post-vendor-bill.ts
//
// The other half of the goods-received accrual.
//
// A receipt now posts `Dr <inventory> / Cr grni` per movement (MIGRATION step
// 5). Nothing relieved that accrual, so without this file GRNI grows by every
// receipt forever and the balance sheet carries a liability that never clears -
// which is the exact failure `build-entry.ts`'s GRNI note warns about, seen from
// the bill side. Enabling `inventory_movement` and leaving `vendor_bill` off is
// therefore not a smaller change; it is a broken one.
//
// The entry itself is `buildVendorBillEntry`, written long ago and never wired.
// It stays its OWN posting type rather than folding into `expense_bill`: that
// one codes to an expense account and cannot express a GRNI or a PPV line, and
// `avenueOfPostingType` already routes both to the same `expenseBill` avenue, so
// the export sees one Bill either way.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildVendorBillEntry } from '../accounting/ledger/builders/entry'
import { resolvePeriodLock } from '../accounting/ledger/periods/period-lock'
import { postEntry } from '../accounting/ledger/post/post-entry'
import { isAccountingEnabled } from '../accounting/ledger/setup/accounting-enabled'
import type { PostResult } from '../accounting/ledger/types'
import { roundCents } from '../sales/totals/totals'
import type { MatchLine } from './types'

const logger = createScopedLogger('purchasing:post-vendor-bill')

export interface PostVendorBillInput {
  organizationId: string
  actorUserId: string
  /** The `vendor_bill` EntityInstance id. The entry's subject and its claim. */
  vendorBillInstanceId: string
  /** The `purchase_order` the bill was matched against, when it names one. */
  purchaseOrderId?: string | null
  /** The `company` the bill is owed to, for the payable line's counterparty. */
  vendorCompanyInstanceId?: string | null
  /** `YYYY-MM-DD`. The bill's own `vendor_bill_billed_at`, never today. */
  txnDate: string
  /** The matched lines, exactly as the three-way match judged them. */
  lines: readonly MatchLine[]
}

/**
 * Post a matched purchasing bill: `Dr grni ± ppv / Cr accounts_payable`.
 *
 * 🛑 The GRNI debit is `Σ quantityReceived × unitPriceExpected` - what the
 * RECEIPT credited, not what the vendor is asking for. Debiting the bill total
 * instead would leave the accrual short by the price variance on every bill, and
 * the entry would still balance.
 *
 * **Never throws.** Every outcome is a `PostResult`; `null` means there was
 * nothing to post (accounting off, or a bill of zero).
 */
export async function postVendorBillEntry(
  db: Database,
  input: PostVendorBillInput
): Promise<PostResult | null> {
  const { organizationId, actorUserId, vendorBillInstanceId, txnDate, lines } = input

  if (!(await isAccountingEnabled(db, organizationId))) return null

  const matchedMinor = lines.reduce(
    (sum, line) => sum + roundCents(line.quantityReceived * line.unitPriceExpected),
    0
  )
  const billTotalMinor = lines.reduce(
    (sum, line) => sum + roundCents(line.quantityBilled * line.unitPriceBilled),
    0
  )
  if (billTotalMinor <= 0) return null

  const entry = buildVendorBillEntry({
    vendorBillId: vendorBillInstanceId,
    periodKey: vendorBillInstanceId,
    txnDate,
    matchedMinor,
    billTotalMinor,
    vendorCompanyInstanceId: input.vendorCompanyInstanceId ?? null,
  })

  const lock = await resolvePeriodLock(organizationId)
  const result = await postEntry(db, {
    organizationId,
    entry,
    lock,
    mode: 'post',
    actorUserId,
    sources: [
      { sourceKind: 'vendor_bill', sourceId: vendorBillInstanceId, linkRole: 'subject' },
      ...(input.purchaseOrderId
        ? [
            {
              sourceKind: 'purchase_order',
              sourceId: input.purchaseOrderId,
              linkRole: 'parent' as const,
            },
          ]
        : []),
      ...(input.vendorCompanyInstanceId
        ? [
            {
              sourceKind: 'company',
              sourceId: input.vendorCompanyInstanceId,
              linkRole: 'counterparty' as const,
            },
          ]
        : []),
    ],
  })

  logger.info('Posted a matched vendor bill', {
    organizationId,
    vendorBillInstanceId,
    status: result.status,
    matchedMinor,
    billTotalMinor,
  })
  return result
}
