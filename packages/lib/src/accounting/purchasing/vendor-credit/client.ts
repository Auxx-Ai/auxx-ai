// packages/lib/src/accounting/purchasing/vendor-credit/client.ts
//
// The client-safe half of the vendor credit module: the status and reason
// vocabularies, the number prefix, and the wire shapes the drawer reads.
// Nothing here imports a database.

import {
  VENDOR_CREDIT_REASON_OPTIONS,
  VENDOR_CREDIT_STATUS_OPTIONS,
} from '../../../resources/registry/resources/vendor-credit-fields'

export { VENDOR_CREDIT_REASON_OPTIONS, VENDOR_CREDIT_STATUS_OPTIONS }

/** `VC-0001`. The `RecordSequence` scope `vendor_credit` allocates on this prefix. */
export const VENDOR_CREDIT_NUMBER_PREFIX = 'VC'

/** `draft -> issued -> settled`, `void` off either. */
export const VENDOR_CREDIT_STATUSES = VENDOR_CREDIT_STATUS_OPTIONS.map((option) => option.value)
export type VendorCreditStatus = (typeof VENDOR_CREDIT_STATUS_OPTIONS)[number]['value']

export const VENDOR_CREDIT_REASONS = VENDOR_CREDIT_REASON_OPTIONS.map((option) => option.value)
export type VendorCreditReason = (typeof VENDOR_CREDIT_REASON_OPTIONS)[number]['value']

export const VENDOR_CREDIT_STATUS_LABELS = Object.fromEntries(
  VENDOR_CREDIT_STATUS_OPTIONS.map((option) => [option.value, option.label])
) as Record<VendorCreditStatus, string>

export const VENDOR_CREDIT_REASON_LABELS = Object.fromEntries(
  VENDOR_CREDIT_REASON_OPTIONS.map((option) => [option.value, option.label])
) as Record<VendorCreditReason, string>

/** The statuses a person may still edit. Past `draft` it is void and re-issue. */
export const VENDOR_CREDIT_EDITABLE_STATUSES: ReadonlySet<string> = new Set<VendorCreditStatus>([
  'draft',
])

/** The statuses that carry a posted entry. A delete is refused on either; void first. */
export const VENDOR_CREDIT_POSTED_STATUSES: ReadonlySet<string> = new Set<VendorCreditStatus>([
  'issued',
  'settled',
])

/** One line as `createVendorCredit` takes it. Money is integer minor units. */
export interface VendorCreditLineDraft {
  description?: string
  quantity: number
  /** Integer minor units per unit. */
  unitPrice: number
  /** Integer minor units. Defaults to `quantity * unitPrice`, rounded. */
  lineTotal?: number
  /**
   * The `gl_account` instance id this line credits. Left unset on a PO-backed
   * credit, where `createVendorCredit` prefills the org's resolved `grni`
   * account; a person may recode it before issue.
   */
  glAccountInstanceId?: string
  partInstanceId?: string
  purchaseOrderLineInstanceId?: string
  /**
   * 73 §8.2: issuing this line sends the goods back — one `return_out` movement
   * at the part's current standard. Off for a price adjustment, which may carry
   * a quantity and must not move stock.
   */
  returnsStock?: boolean
}

/** One application row as the settlement card lists it. */
export interface VendorCreditApplicationRow {
  applicationInstanceId: string
  vendorBillInstanceId: string
  vendorBillNumber: string
  operation?: 'apply' | 'unapply'
  /** Integer minor units. */
  amountMinor: number
  /** ISO instant, or `null`. */
  appliedAt: string | null
}

/** One `vendor_refund` movement settling this credit. */
export interface VendorCreditRefundRow {
  moneyTransactionId: string
  /** Integer minor units. */
  amountMinor: number
  method: string | null
  reference: string | null
  /** `YYYY-MM-DD`. */
  effectiveDate: string
}

/** What `readVendorCreditSettlement` returns. */
export interface VendorCreditSettlement {
  vendorCreditInstanceId: string
  number: string
  status: VendorCreditStatus | string
  vendorInstanceId: string | null
  vendorBillInstanceId: string | null
  /** Integer minor units. */
  totalMinor: number
  amountAppliedMinor: number
  amountRefundedMinor: number
  balanceMinor: number
  applications: VendorCreditApplicationRow[]
  refunds: VendorCreditRefundRow[]
}

/**
 * Plan how much of each credit to apply to a bill, in integer minor units.
 *
 * `planCreditApplication`'s buy-side twin, and pure for the same reason: the
 * apply dialog prefills with it before anything is written.
 */
export function planVendorCreditApplication(
  credits: readonly { id: string; balanceMinor: number }[],
  billBalanceMinor: number
): Array<{ vendorCreditInstanceId: string; amountMinor: number }> {
  const planned: Array<{ vendorCreditInstanceId: string; amountMinor: number }> = []
  let remaining = Math.floor(billBalanceMinor)
  if (!Number.isFinite(remaining) || remaining <= 0) return planned

  for (const credit of credits) {
    if (remaining <= 0) break
    const available = Math.floor(credit.balanceMinor)
    if (!Number.isFinite(available) || available <= 0) continue
    const amountMinor = Math.min(available, remaining)
    planned.push({ vendorCreditInstanceId: credit.id, amountMinor })
    remaining -= amountMinor
  }
  return planned
}
