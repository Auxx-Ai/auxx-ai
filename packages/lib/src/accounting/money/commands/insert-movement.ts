// packages/lib/src/accounting/money/commands/insert-movement.ts

/**
 * The one `MoneyTransaction` insert every writer shares (task 71 §10.2).
 *
 * The caller keeps its own command kind, its document read and balance check, its
 * application or settlement rows and its state sync; this owns only the row and
 * the four checks that are the same in all six writers.
 */

import { schema, type Transaction } from '@auxx/database'
import { BadRequestError } from '../../../errors'
import type { CashEndpointSource } from '../client'
import { validateCashEndpointSource } from '../client'
import type { MovementRow } from '../post-movement'

export interface InsertMovementInput {
  purpose: MovementRow['purpose']
  amountMinor: number | bigint
  /** A hand-recorded movement knows a day; an imported one knows the instant. */
  when: { date: string } | { instant: Date }
  partyInstanceId: string | null
  endpoint: CashEndpointSource
  method: MovementRow['method']
  reference?: string | null
  note?: string | null
  /** The quote a held deposit was collected against (MIGRATION follow-up 7). */
  quoteInstanceId?: string | null
  /** The work order that quote converted into, stamped after the fact. */
  workOrderInstanceId?: string | null
  /** Defaults to USD/2; the posters still refuse anything else (task 71 §2 Q5). */
  currency?: { code: string; exponent: number }
}

/** One `MoneyTransaction` row, validated. The caller writes the application or settlement. */
export async function insertMovement(
  tx: Transaction,
  organizationId: string,
  commandId: string,
  input: InsertMovementInput
): Promise<MovementRow> {
  const amountMinor = BigInt(input.amountMinor)
  if (amountMinor <= 0n)
    throw new BadRequestError('An amount must be a positive whole number of cents')
  if ('date' in input.when && !/^\d{4}-\d{2}-\d{2}$/.test(input.when.date))
    throw new BadRequestError('A movement needs a calendar date')
  validateCashEndpointSource(input.endpoint)

  const [money] = await tx
    .insert(schema.MoneyTransaction)
    .values({
      organizationId,
      purpose: input.purpose,
      amountMinor,
      currency: input.currency?.code ?? 'USD',
      currencyExponent: input.currency?.exponent ?? 2,
      ...('date' in input.when
        ? { datePrecision: 'date' as const, occurredOn: input.when.date }
        : { datePrecision: 'instant' as const, occurredAt: input.when.instant }),
      partyInstanceId: input.partyInstanceId,
      cashAccountInstanceId: input.endpoint.cashAccountInstanceId?.trim() || null,
      paymentGatewayId: input.endpoint.paymentGatewayId?.trim() || null,
      method: input.method,
      recordedByCommandId: commandId,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      quoteInstanceId: input.quoteInstanceId ?? null,
      workOrderInstanceId: input.workOrderInstanceId ?? null,
    })
    .returning()
  if (!money) throw new Error('Money transaction insert returned no row')
  return money
}
