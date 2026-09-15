// packages/database/src/db/schema/payment-route.ts
import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  check,
  foreignKey,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { FinancialSourceAccount } from './financial-source-account'
import { Organization } from './organization'

/** Durable PaymentRoute owner; organization deletion cascades, scoped financial references preserve history. */
export const PaymentRoute = pgTable(
  'PaymentRoute',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    kind: text().notNull().$type<'processor' | 'manual'>(),
    method: text().notNull(),
    settlementCurrency: text().notNull(),
    processorAccountId: text(),
    paymentGatewayInstanceId: text(),
    bankAccountInstanceId: text(),
    cashGlAccountInstanceId: text(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique('PaymentRoute_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'PaymentRoute_processorAccountId_fk',
      columns: [t.organizationId, t.processorAccountId],
      foreignColumns: [FinancialSourceAccount.organizationId, FinancialSourceAccount.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'PaymentRoute_paymentGatewayInstanceId_fk',
      columns: [t.organizationId, t.paymentGatewayInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'PaymentRoute_bankAccountInstanceId_fk',
      columns: [t.organizationId, t.bankAccountInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'PaymentRoute_cashGlAccountInstanceId_fk',
      columns: [t.organizationId, t.cashGlAccountInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    check(
      'PaymentRoute_shape_check',
      sql`(${t.kind} = 'processor' AND ${t.processorAccountId} IS NOT NULL AND ${t.paymentGatewayInstanceId} IS NOT NULL AND ${t.bankAccountInstanceId} IS NULL AND ${t.cashGlAccountInstanceId} IS NULL) OR (${t.kind} = 'manual' AND ${t.processorAccountId} IS NULL AND ${t.paymentGatewayInstanceId} IS NULL AND num_nonnulls(${t.bankAccountInstanceId}, ${t.cashGlAccountInstanceId}) = 1)`
    ),
    uniqueIndex('PaymentRoute_processor_key')
      .on(t.organizationId, t.processorAccountId, t.method, t.settlementCurrency)
      .where(sql`${t.kind} = 'processor'`),
    uniqueIndex('PaymentRoute_bank_key')
      .on(t.organizationId, t.bankAccountInstanceId, t.method, t.settlementCurrency)
      .where(sql`${t.kind} = 'manual' AND ${t.bankAccountInstanceId} IS NOT NULL`),
    uniqueIndex('PaymentRoute_cash_key')
      .on(t.organizationId, t.cashGlAccountInstanceId, t.method, t.settlementCurrency)
      .where(sql`${t.kind} = 'manual' AND ${t.cashGlAccountInstanceId} IS NOT NULL`),
  ]
)
