// packages/lib/src/accounting/purchasing/post-vendor-bill.ts
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
import { readSystemRecords, systemFields } from '../../resources/system-records'
import {
  type BuiltVendorBillEntry,
  buildVendorBillEntry,
  VENDOR_BILL_POSTING_TYPE,
  VENDOR_BILL_SOURCE_TYPE,
} from '../ledger/builders/entry'
import { hashedPeriodKey, MAX_COMPACT_PERIOD_KEY } from '../ledger/periods/period-key'
import { resolvePeriodLock } from '../ledger/periods/period-lock'
import { readAutoPostMode } from '../ledger/post/auto-post'
import { LEDGER_CURRENCY, postEntry } from '../ledger/post/post-entry'
import { isAccountingEnabled } from '../ledger/setup/accounting-enabled'
import type { PostResult } from '../ledger/types'
import { writeBillDraftPosting } from './bill-ledger-state'
import type { VendorBillLineRecord, VendorBillRecord } from './expense-bill/reads'
import type { AllocationBasis } from './types'

const ORDER_BASIS_ATTRIBUTES = ['purchase_order_allocation_basis'] as const

const logger = createScopedLogger('purchasing:post-vendor-bill')

const ALLOCATION_BASES: ReadonlySet<string> = new Set(['value', 'quantity', 'weight'])

/**
 * The order's own `purchase_order_allocation_basis`, for spreading the bill's
 * header legs across its goods lines (73 D5).
 *
 * `value` for an expense bill and for an order that names none: it is the
 * registry default, and the only basis that needs no per-line figure the bill
 * may not carry.
 */
export async function readAllocationBasis(
  db: Database,
  organizationId: string,
  purchaseOrderId: string | null | undefined
): Promise<AllocationBasis> {
  if (!purchaseOrderId) return 'value'
  const ctx = await systemFields(db, organizationId, 'purchase_order', ORDER_BASIS_ATTRIBUTES)
  if (!ctx) return 'value'
  const [order] = await readSystemRecords(db, organizationId, ctx, { ids: [purchaseOrderId] })
  const stored = order?.option('purchase_order_allocation_basis')
  return stored && ALLOCATION_BASES.has(stored) ? (stored as AllocationBasis) : 'value'
}

export interface VendorBillEntrySource {
  bill: VendorBillRecord
  lines: readonly VendorBillLineRecord[]
  /** `YYYY-MM-DD`. The accounting date the entry is dated, resolved by the door. */
  billedAt: string
  /** The order's own basis. Defaults to `value`; it never changes what posts. */
  allocationBasis?: AllocationBasis
  /** How many times this bill has posted. 1 (the default) keys on the internal number. */
  generation?: number
}

/**
 * The claim and document-number key for one generation of a bill's entry.
 *
 * Generation 1 is the internal number verbatim (`BILL-0002` -> `AUXX-BIL-BILL0002`)
 * and must stay so, or every bill already in a ledger re-keys. A repost cannot
 * reuse it: Save reverses the original at `-R1`, which frees the CLAIM but
 * leaves `AUXX-BIL-BILL0002` standing on the reversed row, and `docNumber` is
 * unique per org.
 *
 * So a repost keys on the number's DIGITS plus a generation marker -
 * `0002G2` -> `AUXX-BIL-0002G2`, whose own reversal `AUXX-BIL-0002G2-R1` is 18
 * of the 21 characters allowed. `BILL0002G2` would be 10 against a 9-character
 * budget and does not fit. When the internal number carries no digits, or the
 * marker would not fit beside them, the key falls back to a 6-digit hash of the
 * number and the generation (`BGN-<hash>`), which always fits.
 */
export function vendorBillEntryKey(internalNumber: string, generation: number): string | undefined {
  if (generation <= 1) return undefined
  const digits = internalNumber.replace(/\D/g, '')
  const marked = `${digits}G${generation}`
  if (digits.length > 0 && marked.length <= MAX_COMPACT_PERIOD_KEY) return marked
  return hashedPeriodKey({
    prefix: 'BGN',
    sourceId: `${internalNumber}:${generation}`,
    label: 'vendor bill repost',
    idLabel: 'internal number',
  })
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
    periodKey: vendorBillEntryKey(bill.internalNumber, source.generation ?? 1),
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
 * converges to `already_posted`. A repost after an edit keys on a later
 * generation of it - see {@link vendorBillEntryKey}. The mode follows the `expenseBill` avenue,
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

  // A draft writes no subject row, so this pointer is the bill's only way back
  // to the entry it is waiting on; a real post makes the subject link the truth.
  if (result.status === 'drafted' && result.glPostingId) {
    await writeBillDraftPosting(db, organizationId, vendorBillInstanceId, result.glPostingId)
  } else if (result.status === 'posted' || result.status === 'already_posted') {
    await writeBillDraftPosting(db, organizationId, vendorBillInstanceId, null)
  }

  logger.info('Posted a vendor bill', {
    organizationId,
    vendorBillInstanceId,
    postingType: VENDOR_BILL_POSTING_TYPE,
    status: result.status,
    totalMinor: entry.totalMinor,
  })
  return result
}
