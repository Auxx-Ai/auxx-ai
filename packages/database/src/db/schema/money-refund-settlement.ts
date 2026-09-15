// packages/database/src/db/schema/money-refund-settlement.ts
import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  bigint,
  check,
  foreignKey,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { MoneyCommand } from './money-command'
import { MoneyTransaction } from './money-transaction'
import { Organization } from './organization'

/** Durable MoneyRefundSettlement owner; organization deletion cascades, scoped financial references preserve history. */
export const MoneyRefundSettlement = pgTable(
  'MoneyRefundSettlement',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    refundTransactionId: text().notNull(),
    originalTransactionId: text(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    disposition: text().notNull().$type<'customer_credit' | 'vendor_credit' | 'unapplied_money'>(),
    customerCreditMemoInstanceId: text(),
    vendorCreditInstanceId: text(),
    unappliedMoneyTransactionId: text(),
    commandId: text().notNull(),
    commandItemKey: text().notNull(),
  },
  (t) => [
    unique('MoneyRefundSettlement_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'MoneyRefundSettlement_refundTransactionId_fk',
      columns: [t.organizationId, t.refundTransactionId],
      foreignColumns: [MoneyTransaction.organizationId, MoneyTransaction.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyRefundSettlement_originalTransactionId_fk',
      columns: [t.organizationId, t.originalTransactionId],
      foreignColumns: [MoneyTransaction.organizationId, MoneyTransaction.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyRefundSettlement_customerCreditMemoInstanceId_fk',
      columns: [t.organizationId, t.customerCreditMemoInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyRefundSettlement_vendorCreditInstanceId_fk',
      columns: [t.organizationId, t.vendorCreditInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyRefundSettlement_unappliedMoneyTransactionId_fk',
      columns: [t.organizationId, t.unappliedMoneyTransactionId],
      foreignColumns: [MoneyTransaction.organizationId, MoneyTransaction.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyRefundSettlement_commandId_fk',
      columns: [t.organizationId, t.commandId],
      foreignColumns: [MoneyCommand.organizationId, MoneyCommand.id],
    }).onDelete('no action'),
    unique('MoneyRefundSettlement_command_key').on(t.organizationId, t.commandId, t.commandItemKey),
    check(
      'MoneyRefundSettlement_shape_check',
      sql`${t.amountMinor} > 0 AND ((${t.disposition} = 'customer_credit' AND ${t.customerCreditMemoInstanceId} IS NOT NULL AND ${t.vendorCreditInstanceId} IS NULL AND ${t.unappliedMoneyTransactionId} IS NULL) OR (${t.disposition} = 'vendor_credit' AND ${t.customerCreditMemoInstanceId} IS NULL AND ${t.vendorCreditInstanceId} IS NOT NULL AND ${t.unappliedMoneyTransactionId} IS NULL) OR (${t.disposition} = 'unapplied_money' AND ${t.customerCreditMemoInstanceId} IS NULL AND ${t.vendorCreditInstanceId} IS NULL AND ${t.unappliedMoneyTransactionId} IS NOT NULL))`
    ),
  ]
)
