// packages/lib/src/accounting/purchasing/vendor-credit/settle.ts
//
// The settlement writer: the ONLY writer of `vendor_credit_amount_applied`,
// `vendor_credit_amount_refunded`, `vendor_credit_balance` and of the
// `issued <-> settled` flip. Every writer in this module ends by calling it.
//
// Re-sums from the SOURCES on every call - the application rows and the
// `vendor_refund` movements - never from the mirrors it is about to rewrite.

import { type Database, database } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getEntityDefIdResolver } from '../../../cache'
import { FieldValueService } from '../../../field-values/field-value-service'
import type { VendorCreditStatus } from './client'
import { requireVendorCredit, sumVendorCreditApplications, sumVendorCreditRefunds } from './reads'

/** The one field the settlement projection writes past any future status wall. */
export const VENDOR_CREDIT_STATUS_BYPASS = new Set<SystemAttribute>(['vendor_credit_status'])

export interface SettleVendorCreditInput {
  organizationId: string
  userId: string
  vendorCreditInstanceId: string
}

/** What the settlement wrote, or found already written. */
export interface VendorCreditSettlementState {
  /** Integer minor units. */
  amountAppliedMinor: number
  amountRefundedMinor: number
  balanceMinor: number
  status: VendorCreditStatus | string
}

/**
 * Re-derive applied, refunded and balance from their sources, write the three
 * mirrors, and flip `issued <-> settled` on the balance.
 *
 * A `draft` gets its amounts written (they are zero) but never a status: only
 * `issueVendorCredit` moves a draft. A `void` credit is left exactly as it is.
 */
export async function settleVendorCredit(
  db: Database,
  input: SettleVendorCreditInput
): Promise<VendorCreditSettlementState> {
  const { organizationId, userId, vendorCreditInstanceId } = input
  const credit = await requireVendorCredit(db, organizationId, vendorCreditInstanceId)

  if (credit.status === 'void') {
    return {
      amountAppliedMinor: credit.amountAppliedMinor,
      amountRefundedMinor: credit.amountRefundedMinor,
      balanceMinor: credit.balanceMinor,
      status: credit.status,
    }
  }

  const [amountAppliedMinor, amountRefundedMinor] = await Promise.all([
    sumVendorCreditApplications(db, organizationId, vendorCreditInstanceId),
    sumVendorCreditRefunds(db, organizationId, vendorCreditInstanceId),
  ])
  const balanceMinor = Math.max(0, credit.totalMinor - amountAppliedMinor - amountRefundedMinor)

  let nextStatus = credit.status
  if (credit.status === 'issued' || credit.status === 'settled') {
    nextStatus = balanceMinor <= 0 ? 'settled' : 'issued'
  }

  const writes: Array<{ fieldId: string; value: unknown }> = []
  if (amountAppliedMinor !== credit.amountAppliedMinor)
    writes.push({ fieldId: 'vendor_credit_amount_applied', value: amountAppliedMinor })
  if (amountRefundedMinor !== credit.amountRefundedMinor)
    writes.push({ fieldId: 'vendor_credit_amount_refunded', value: amountRefundedMinor })
  if (balanceMinor !== credit.balanceMinor)
    writes.push({ fieldId: 'vendor_credit_balance', value: balanceMinor })
  if (nextStatus !== credit.status)
    writes.push({ fieldId: 'vendor_credit_status', value: nextStatus })

  if (writes.length > 0) {
    const resolveDefId = await getEntityDefIdResolver(organizationId)
    const fieldValueService = new FieldValueService(
      organizationId,
      userId,
      db === database ? undefined : db,
      undefined,
      { bypassFieldGuards: VENDOR_CREDIT_STATUS_BYPASS }
    )
    await fieldValueService.setValuesForEntity({
      recordId: toRecordId(resolveDefId('vendor_credit'), vendorCreditInstanceId),
      values: writes,
    })
  }

  return { amountAppliedMinor, amountRefundedMinor, balanceMinor, status: nextStatus }
}
