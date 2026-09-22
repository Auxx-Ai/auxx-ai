// packages/lib/src/accounting/money/bank-deposits/eligibility.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'

/**
 * Deposit eligibility, evaluated before pagination and again under the receipt lock.
 * A local recording explicitly chooses its endpoint. Imports start with empty
 * endpoints, so only one accepted, live manual source establishes eligibility.
 * Posting status and the document receiving the payment do not decide this.
 */
export function bankDepositEligibility(organizationId: string): SQL {
  const money = schema.MoneyTransaction
  const command = schema.MoneyCommand
  const link = schema.MoneySourceLink
  const acceptance = schema.FinancialSourceAcceptance
  const object = schema.FinancialSourceObject
  const observation = schema.FinancialSourceObservation
  const account = schema.FinancialSourceAccount

  return and(
    eq(money.organizationId, organizationId),
    eq(money.purpose, 'customer_receipt'),
    isNull(money.paymentGatewayId),
    isNull(money.cashAccountInstanceId),
    isNull(money.bankDepositInstanceId),
    // Uncorrelated sets let PostgreSQL evaluate source evidence once for the org,
    // rather than scanning the source tables again for every imported receipt.
    sql`(
      (${money.recordedByCommandId} in (
        select ${command.id} from ${command}
        where ${command.organizationId} = ${organizationId}
          and ${command.kind} = 'record_invoice_payment'
      ) and ${money.id} not in (
        select ${link.moneyTransactionId} from ${link}
        where ${link.organizationId} = ${organizationId}
      ))
      or (${money.recordedByCommandId} in (
        select ${command.id} from ${command}
        where ${command.organizationId} = ${organizationId}
          and ${command.kind} = 'import_customer_money'
      ) and ${money.id} in (
        select ${acceptance.moneyTransactionId} from ${acceptance}
        where ${acceptance.organizationId} = ${organizationId}
          and ${acceptance.moneyTransactionId} is not null
        group by ${acceptance.moneyTransactionId} having count(*) = 1
      ) and ${money.id} in (
        select ${link.moneyTransactionId} from ${link}
        left join ${acceptance} on ${acceptance.organizationId} = ${link.organizationId}
          and ${acceptance.sourceObjectId} = ${link.sourceObjectId}
          and ${acceptance.moneyTransactionId} = ${link.moneyTransactionId}
        left join ${object} on ${object.organizationId} = ${link.organizationId}
          and ${object.id} = ${link.sourceObjectId}
        left join ${observation} on ${observation.organizationId} = ${acceptance.organizationId}
          and ${observation.id} = ${acceptance.observationId}
          and ${observation.sourceObjectId} = ${object.id}
        left join ${account} on ${account.organizationId} = ${object.organizationId}
          and ${account.id} = ${object.sourceAccountId}
        where ${link.organizationId} = ${organizationId}
        group by ${link.moneyTransactionId}
        having count(*) = 1 and bool_and(coalesce(
          ${acceptance.state} = 'accepted'
          and ${account.environment} = 'live'
          and ${account.archivedAt} is null
          and lower(btrim(${observation.payload}->>'gateway')) = 'manual'
          and ${observation.payload}->'test' = 'false'::jsonb,
          false
        ))
      ))
    )`
  )!
}

/** Recheck selected receipts using exactly the list's eligibility rule. */
export async function readEligibleDepositPaymentIds(
  db: Database,
  organizationId: string,
  paymentIds: string[]
): Promise<Set<string>> {
  if (paymentIds.length === 0) return new Set()
  const rows = await db
    .select({ id: schema.MoneyTransaction.id })
    .from(schema.MoneyTransaction)
    .where(
      and(bankDepositEligibility(organizationId), inArray(schema.MoneyTransaction.id, paymentIds))
    )
  return new Set(rows.map((row) => row.id))
}
