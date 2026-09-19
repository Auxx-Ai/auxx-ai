// packages/lib/src/purchasing/post-vendor-bill.ts
//
// The one poster for a vendor bill, of either kind (73 D3).
//
// A receipt posts `Dr <inventory> / Cr grni` per movement; this is the other
// half of that accrual, and the only door that raises the payable. There used to
// be two - the match hook's, keyed on the `matched` verdict, and the expense
// bill's Post - which meant one supplier invoice could land in the books twice
// on two posting types, with A/P double the invoice and a void reversing one of
// them. One record, one entry, one type.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  type BuiltVendorBillEntry,
  buildVendorBillEntry,
  VENDOR_BILL_POSTING_TYPE,
  VENDOR_BILL_SOURCE_TYPE,
} from '../accounting/ledger/builders/entry'
import { resolvePeriodLock } from '../accounting/ledger/periods/period-lock'
import { readAutoPostMode } from '../accounting/ledger/post/auto-post'
import { LEDGER_CURRENCY, postEntry } from '../accounting/ledger/post/post-entry'
import { isAccountingEnabled } from '../accounting/ledger/setup/accounting-enabled'
import type { PostResult } from '../accounting/ledger/types'
import type { VendorBillLineRecord, VendorBillRecord } from './expense-bill/reads'
import type { AllocationBasis } from './types'

const logger = createScopedLogger('purchasing:post-vendor-bill')

export interface VendorBillEntrySource {
  bill: VendorBillRecord
  lines: readonly VendorBillLineRecord[]
  /** `YYYY-MM-DD`. The accounting date the entry is dated, resolved by the door. */
  billedAt: string
  /** The order's own basis. Defaults to `value`; it never changes what posts. */
  allocationBasis?: AllocationBasis
}

/**
 * The entry this bill's CURRENT values produce - pure, persists nothing.
 *
 * The one place the record shape meets the builder, so the Post action, the
 * preview and 73 U3's compare-and-repost on Save cannot disagree about what a
 * bill's entry is.
 */
export function buildEntryForVendorBill(source: VendorBillEntrySource): BuiltVendorBillEntry {
  const { bill, lines, billedAt } = source
  return buildVendorBillEntry({
    vendorBillId: bill.id,
    internalNumber: bill.internalNumber,
    billedAt,
    currency: bill.currency,
    ledgerCurrency: LEDGER_CURRENCY,
    totalMinor: bill.totalMinor,
    shippingMinor: bill.shippingMinor,
    taxMinor: bill.taxMinor,
    discountMinor: bill.discountMinor,
    allocationBasis: source.allocationBasis,
    lines: lines.map((line) => ({
      lineId: line.id,
      description: line.description,
      lineTotalMinor: line.lineTotalMinor,
      quantityBilled: line.quantityBilled,
      purchaseOrderLineId: line.purchaseOrderLineId,
      unitPriceExpectedMinor: line.unitPriceExpectedMinor,
      glAccountId: line.glAccountId,
    })),
    vendorCompanyInstanceId: bill.vendorCompanyInstanceId,
    memo: `Bill ${bill.number || bill.internalNumber}`,
  })
}

export interface PostVendorBillEntryInput {
  organizationId: string
  actorUserId: string
  /** The `vendor_bill` EntityInstance id. The entry's subject and its claim. */
  vendorBillInstanceId: string
  /** The `purchase_order` the bill names, when it names one. */
  purchaseOrderId?: string | null
  /** The `company` the bill is owed to, for the payable line's counterparty. */
  vendorCompanyInstanceId?: string | null
  entry: BuiltVendorBillEntry
  memo?: string
}

/**
 * Put the built entry in the books.
 *
 * Idempotent by the claim's unique index: the period key is the bill's own
 * INTERNAL number, `RecordSequence`-issued and unique in the org, so a second
 * Post claims the same `(org, vendor_bill, periodKey, revision=0)` tuple and
 * converges to `already_posted`. The mode follows the `expenseBill` avenue,
 * which is the one buy-side document lane.
 *
 * **Never throws.** Every outcome is a `PostResult`; `null` means accounting is
 * off, which is a first-class case and not a degraded one.
 */
export async function postVendorBillEntry(
  db: Database,
  input: PostVendorBillEntryInput
): Promise<PostResult | null> {
  const { organizationId, actorUserId, vendorBillInstanceId, entry } = input

  if (!(await isAccountingEnabled(db, organizationId))) return null

  const lock = await resolvePeriodLock(organizationId)
  const result = await postEntry(db, {
    organizationId,
    entry: entry.entry,
    lock,
    mode: await readAutoPostMode(organizationId, 'expenseBill'),
    memo: input.memo,
    actorUserId,
    sources: [
      { sourceKind: VENDOR_BILL_SOURCE_TYPE, sourceId: vendorBillInstanceId, linkRole: 'subject' },
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

  logger.info('Posted a vendor bill', {
    organizationId,
    vendorBillInstanceId,
    postingType: VENDOR_BILL_POSTING_TYPE,
    status: result.status,
    totalMinor: entry.totalMinor,
  })
  return result
}
