// packages/database/src/db/schema/money-transaction.ts
import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { MoneyCommand } from './money-command'
import { Organization } from './organization'

/** Durable MoneyTransaction owner; organization deletion cascades, scoped financial references preserve history. */
export const MoneyTransaction = pgTable(
  'MoneyTransaction',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    purpose: text()
      .notNull()
      .$type<'customer_receipt' | 'customer_refund' | 'vendor_payment' | 'vendor_refund'>(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    currency: text().notNull(),
    currencyExponent: integer().notNull(),
    datePrecision: text().notNull().$type<'instant' | 'date'>(),
    occurredAt: timestamp({ withTimezone: true }),
    occurredOn: date(),
    partyInstanceId: text(),
    cashAccountInstanceId: text(),
    /**
     * The `payment_gateway` the money moved through, when it moved through one.
     * Set once, when known: at record time by hand, at post time from the feed
     * link for a channel movement. Exclusive with `cashAccountInstanceId`.
     */
    paymentGatewayId: text(),
    /**
     * Why the ledger last refused this movement, and when. Written by
     * `postMovementEntry` on every `blocked` result, cleared on `accepted`; the
     * sweep backs off on it rather than retrying the same refusal every run.
     * The mirror of `payout_blocked_reason` on the payout record.
     */
    postingBlockedReason: text(),
    postingBlockedAt: timestamp({ withTimezone: true }),
    /** How the money moved — descriptive only; nullable because channel money has none. */
    method: text().$type<'cash' | 'check' | 'card' | 'bank' | 'other'>(),
    recordedByCommandId: text().notNull(),
    reference: text(),
    note: text(),
    /**
     * The quote this receipt was collected against, when it is a held deposit
     * (MIGRATION follow-up 7). Set once, at checkout time - never read back off
     * `MoneyCommand.actorSnapshot`.
     */
    quoteInstanceId: text(),
    /** The work order a quote deposit's quote converted into, stamped after the fact. */
    workOrderInstanceId: text(),
    /**
     * The `bank_deposit` this receipt was grouped into (MIGRATION follow-up 9) -
     * the direct replacement for the retired `payment` entity's
     * `payment_bank_deposit` mirror. Null while the receipt sits in undeposited
     * funds.
     */
    bankDepositInstanceId: text(),
  },
  (t) => [
    unique('MoneyTransaction_org_id_key').on(t.organizationId, t.id),
    index('MoneyTransaction_quote_idx').on(t.organizationId, t.quoteInstanceId),
    index('MoneyTransaction_work_order_idx').on(t.organizationId, t.workOrderInstanceId),
    index('MoneyTransaction_bank_deposit_idx').on(t.organizationId, t.bankDepositInstanceId),
    index('MoneyTransaction_payment_gateway_idx').on(t.organizationId, t.paymentGatewayId),
    foreignKey({
      name: 'MoneyTransaction_partyInstanceId_fk',
      columns: [t.organizationId, t.partyInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyTransaction_cashAccountInstanceId_fk',
      columns: [t.organizationId, t.cashAccountInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyTransaction_recordedByCommandId_fk',
      columns: [t.organizationId, t.recordedByCommandId],
      foreignColumns: [MoneyCommand.organizationId, MoneyCommand.id],
    }).onDelete('no action'),
    check(
      'MoneyTransaction_money_check',
      sql`${t.amountMinor} > 0 AND ${t.currency} ~ '^[A-Z]{3}$' AND ${t.currencyExponent} BETWEEN 0 AND 4 AND ${t.purpose} IN ('customer_receipt','customer_refund','vendor_payment','vendor_refund')`
    ),
    check(
      'MoneyTransaction_date_check',
      sql`(${t.datePrecision} = 'instant' AND ${t.occurredAt} IS NOT NULL AND ${t.occurredOn} IS NULL) OR (${t.datePrecision} = 'date' AND ${t.occurredAt} IS NULL AND ${t.occurredOn} IS NOT NULL)`
    ),
    check(
      'MoneyTransaction_endpoint_check',
      sql`NOT (${t.paymentGatewayId} IS NOT NULL AND ${t.cashAccountInstanceId} IS NOT NULL)`
    ),
  ]
)
