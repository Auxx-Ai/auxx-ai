// packages/lib/src/accounting/money/vendor-payments/payment-reads.ts

/** The payments applied to a vendor bill — the A/P twin of `invoice-payments/payment-reads.ts`. */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'

export interface VendorBillPaymentRow {
  moneyTransactionId: string
  /** Integer minor units, already netted over `apply` minus `unapply`. */
  allocatedAmount: number
  /** `YYYY-MM-DD`. */
  effectiveDate: string
  method: string | null
  reference: string | null
  paymentGatewayId: string | null
  cashAccountInstanceId: string | null
}

/** One row per movement applied to this bill, oldest first; fully reversed ones dropped. */
export async function listVendorBillPayments(
  db: Database,
  params: { organizationId: string; vendorBillInstanceId: string }
): Promise<VendorBillPaymentRow[]> {
  const { organizationId, vendorBillInstanceId } = params
  const rows = await db
    .select({
      moneyTransactionId: schema.MoneyApplication.moneyTransactionId,
      operation: schema.MoneyApplication.operation,
      amountMinor: schema.MoneyApplication.amountMinor,
      effectiveDate: schema.MoneyApplication.effectiveDate,
      method: schema.MoneyTransaction.method,
      reference: schema.MoneyTransaction.reference,
      paymentGatewayId: schema.MoneyTransaction.paymentGatewayId,
      cashAccountInstanceId: schema.MoneyTransaction.cashAccountInstanceId,
    })
    .from(schema.MoneyApplication)
    .innerJoin(
      schema.MoneyTransaction,
      and(
        eq(schema.MoneyTransaction.id, schema.MoneyApplication.moneyTransactionId),
        eq(schema.MoneyTransaction.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(schema.MoneyApplication.organizationId, organizationId),
        eq(schema.MoneyApplication.vendorBillInstanceId, vendorBillInstanceId)
      )
    )
    .orderBy(asc(schema.MoneyApplication.id))

  const byMovement = new Map<string, VendorBillPaymentRow>()
  for (const row of rows) {
    const existing = byMovement.get(row.moneyTransactionId)
    const delta = Number(row.operation === 'apply' ? row.amountMinor : -row.amountMinor)
    if (existing) existing.allocatedAmount += delta
    else
      byMovement.set(row.moneyTransactionId, {
        moneyTransactionId: row.moneyTransactionId,
        allocatedAmount: delta,
        effectiveDate: row.effectiveDate,
        method: row.method,
        reference: row.reference,
        paymentGatewayId: row.paymentGatewayId,
        cashAccountInstanceId: row.cashAccountInstanceId,
      })
  }
  return [...byMovement.values()].filter((row) => row.allocatedAmount !== 0)
}
