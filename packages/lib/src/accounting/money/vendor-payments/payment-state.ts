// packages/lib/src/accounting/money/vendor-payments/payment-state.ts

/**
 * Project the money model onto a vendor bill's `amount_paid` / `paid_at` /
 * `payment_status` — the one writer of those three (task 71 D7, task 73 D1).
 *
 * 🛑 It never touches `vendor_bill_status`. That field is the document
 * lifecycle, and a money value landing on it switched the three-way match off
 * for the bill forever (73 §1.2).
 */

import { type Database, database } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getEntityDefIdResolver, getOrgCache } from '../../../cache'
import { FieldValueService } from '../../../field-values/field-value-service'
import { readFieldScalars } from '../../../field-values/read-field-scalars'
import { netApplied } from '../client'
import { listVendorBillApplications, sumAppliedToVendorBill } from '../reads'

const STATE_ATTRS = [
  'vendor_bill_total',
  'vendor_bill_payment_status',
  'vendor_bill_amount_paid',
  'vendor_bill_amount_credited',
  'vendor_bill_amount_discounted',
  'vendor_bill_paid_at',
] as const satisfies readonly SystemAttribute[]

export interface SyncVendorBillPaymentStateInput {
  organizationId: string
  userId: string
  vendorBillInstanceId: string
}

/** Integer minor units: every `vendor_payment` applied to this bill, netted. */
export async function sumVendorBillPayments(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string
): Promise<number> {
  const settled = await sumAppliedToVendorBill(db, organizationId, vendorBillInstanceId)
  return Number(settled.amountMinor)
}

/**
 * Integer minor units: the early-payment discounts taken on this bill's
 * payments, netted (74 D3). Separate from {@link sumVendorBillPayments} because
 * `amount_paid` is the MONEY and nothing else.
 */
export async function sumVendorBillDiscounts(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string
): Promise<number> {
  const settled = await sumAppliedToVendorBill(db, organizationId, vendorBillInstanceId)
  return Number(settled.discountMinor)
}

/** Recompute one bill's settled amount, paid date and payment status. */
export async function syncVendorBillPaymentState(
  db: Database,
  input: SyncVendorBillPaymentStateInput
): Promise<void> {
  const { organizationId, userId, vendorBillInstanceId } = input
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([...STATE_ATTRS])
  const totalField = fields.vendor_bill_total
  const paymentStatusField = fields.vendor_bill_payment_status
  const amountPaidField = fields.vendor_bill_amount_paid
  const paidAtField = fields.vendor_bill_paid_at
  // Absent until the vendor credit def lands on the org; an org without it
  // simply has no credits to net off.
  const amountCreditedField = fields.vendor_bill_amount_credited
  // Absent until the org has been provisioned with 74's discount field.
  const amountDiscountedField = fields.vendor_bill_amount_discounted
  if (!totalField || !paymentStatusField || !amountPaidField || !paidAtField) return

  const applications = await listVendorBillApplications(db, organizationId, vendorBillInstanceId)
  const amountPaid = Number(netApplied(applications))
  // The forgiven part, netted the same way: a void's `unapply` row carries the
  // discount it takes back, so this returns to zero with the money.
  const amountDiscounted = Number(
    applications.reduce(
      (sum, a) => sum + (a.operation === 'apply' ? 1n : -1n) * (a.discountMinor ?? 0n),
      0n
    )
  )
  const latestApplied = applications
    .filter((a) => a.operation === 'apply')
    .map((a) => a.effectiveDate)
    .sort()
    .at(-1)

  const readFieldIds = [totalField.id, paymentStatusField.id, amountPaidField.id]
  if (amountCreditedField) readFieldIds.push(amountCreditedField.id)
  if (amountDiscountedField) readFieldIds.push(amountDiscountedField.id)
  const scalars = (
    await readFieldScalars(db, organizationId, [vendorBillInstanceId], readFieldIds)
  ).get(vendorBillInstanceId)
  const total = scalars?.get(totalField.id)
  const paymentStatus = scalars?.get(paymentStatusField.id)
  const currentAmountPaid = numberOrZero(scalars?.get(amountPaidField.id))
  const credited = amountCreditedField ? numberOrZero(scalars?.get(amountCreditedField.id)) : 0
  const currentAmountDiscounted = amountDiscountedField
    ? numberOrZero(scalars?.get(amountDiscountedField.id))
    : 0

  // A credit note settles a bill just as a payment does, and so does a discount
  // the vendor granted: each is what the vendor no longer asks for. `paid` is
  // "nothing is owed", not "cash left".
  const settled = amountPaid + credited + amountDiscounted
  let nextStatus = 'unpaid'
  if (settled > 0 && typeof total === 'number' && settled >= Math.round(total)) nextStatus = 'paid'
  else if (settled > 0) nextStatus = 'partially_paid'

  // The day the bill was SETTLED, not the day of the first instalment.
  const paidAt = nextStatus === 'paid' && latestApplied ? `${latestApplied}T00:00:00.000Z` : null

  const writes: Array<{ fieldId: string; value: unknown }> = []
  if (amountPaid !== currentAmountPaid)
    writes.push({ fieldId: amountPaidField.id, value: amountPaid })
  if (amountDiscountedField && amountDiscounted !== currentAmountDiscounted)
    writes.push({ fieldId: amountDiscountedField.id, value: amountDiscounted })
  writes.push({ fieldId: paidAtField.id, value: paidAt })
  if (nextStatus !== paymentStatus)
    writes.push({ fieldId: paymentStatusField.id, value: nextStatus })

  const resolveDefId = await getEntityDefIdResolver(organizationId)
  const service = new FieldValueService(
    organizationId,
    userId,
    db === database ? undefined : db,
    undefined
  )
  await service.setValuesForEntity({
    recordId: toRecordId(resolveDefId('vendor_bill'), vendorBillInstanceId),
    values: writes,
  })
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' ? value : 0
}
