// packages/lib/src/accounting/money/writes.ts

/**
 * The one `MoneyApplication` insert every writer shares (plans/accounting/LIB-READS.md
 * §2.1), beside `commands/insert-movement.ts`'s row for the movement itself.
 */

import { schema, type Transaction } from '@auxx/database'
import { BadRequestError } from '../../errors'

export interface InsertApplicationInput {
  moneyTransactionId: string
  operation: 'apply' | 'unapply'
  amountMinor: number | bigint
  /** Early-payment discount taken alongside this money (74 D3). */
  discountMinor?: number | bigint | null
  /** `YYYY-MM-DD` — the day the application belongs to in the books. */
  effectiveDate: string
  /** Defaults to now; pass the observed instant when the source reports one. */
  appliedAt?: Date
  /** Exactly one of the three documents. */
  invoiceInstanceId?: string | null
  orderInstanceId?: string | null
  vendorBillInstanceId?: string | null
  /** Where held money came from, when it was a quote deposit. Not a document. */
  quoteInstanceId?: string | null
  /** Required for `unapply`, forbidden for `apply` — the schema enforces both. */
  reversesApplicationId?: string | null
  /** Unique within the command; the retry key for this one row. */
  commandItemKey: string
}

/** One `MoneyApplication` row, validated. */
export async function insertApplication(
  tx: Transaction,
  organizationId: string,
  commandId: string,
  input: InsertApplicationInput
): Promise<{ id: string }> {
  const amountMinor = BigInt(input.amountMinor)
  if (amountMinor <= 0n)
    throw new BadRequestError('An applied amount must be a positive whole number of cents')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate))
    throw new BadRequestError('An application needs a calendar date')

  const [row] = await tx
    .insert(schema.MoneyApplication)
    .values({
      organizationId,
      moneyTransactionId: input.moneyTransactionId,
      operation: input.operation,
      amountMinor,
      ...(input.discountMinor == null ? {} : { discountMinor: BigInt(input.discountMinor) }),
      invoiceInstanceId: input.invoiceInstanceId ?? null,
      orderInstanceId: input.orderInstanceId ?? null,
      vendorBillInstanceId: input.vendorBillInstanceId ?? null,
      quoteInstanceId: input.quoteInstanceId ?? null,
      appliedAt: input.appliedAt ?? new Date(),
      effectiveDate: input.effectiveDate,
      reversesApplicationId: input.reversesApplicationId ?? null,
      commandId,
      commandItemKey: input.commandItemKey,
    })
    .returning({ id: schema.MoneyApplication.id })
  if (!row) throw new Error('Money application insert returned no row')
  return row
}
