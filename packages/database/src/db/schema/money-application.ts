// packages/database/src/db/schema/money-application.ts
import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
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

/** Durable MoneyApplication owner; organization deletion cascades, scoped financial references preserve history. */
export const MoneyApplication = pgTable(
  'MoneyApplication',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    moneyTransactionId: text().notNull(),
    operation: text().notNull().$type<'apply' | 'unapply'>(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    orderInstanceId: text(),
    invoiceInstanceId: text(),
    vendorBillInstanceId: text(),
    appliedAt: timestamp({ withTimezone: true }).notNull(),
    effectiveDate: date().notNull(),
    reversesApplicationId: text(),
    commandId: text().notNull(),
    commandItemKey: text().notNull(),
  },
  (t) => [
    unique('MoneyApplication_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'MoneyApplication_moneyTransactionId_fk',
      columns: [t.organizationId, t.moneyTransactionId],
      foreignColumns: [MoneyTransaction.organizationId, MoneyTransaction.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyApplication_orderInstanceId_fk',
      columns: [t.organizationId, t.orderInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyApplication_invoiceInstanceId_fk',
      columns: [t.organizationId, t.invoiceInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyApplication_vendorBillInstanceId_fk',
      columns: [t.organizationId, t.vendorBillInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyApplication_commandId_fk',
      columns: [t.organizationId, t.commandId],
      foreignColumns: [MoneyCommand.organizationId, MoneyCommand.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyApplication_reversesApplicationId_fk',
      columns: [t.organizationId, t.reversesApplicationId],
      foreignColumns: [t.organizationId, t.id],
    }).onDelete('no action'),
    unique('MoneyApplication_command_key').on(t.organizationId, t.commandId, t.commandItemKey),
    check(
      'MoneyApplication_shape_check',
      sql`${t.amountMinor} > 0 AND num_nonnulls(${t.orderInstanceId}, ${t.invoiceInstanceId}, ${t.vendorBillInstanceId}) = 1 AND ((${t.operation} = 'apply' AND ${t.reversesApplicationId} IS NULL) OR (${t.operation} = 'unapply' AND ${t.reversesApplicationId} IS NOT NULL))`
    ),
  ]
)
