// packages/database/src/db/schema/money-transfer.ts
import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { FinancialSourceAccount } from './financial-source-account'
import { FinancialSourceObject } from './financial-source-object'
import { FinancialSourceObservation } from './financial-source-observation'
import { Organization } from './organization'

/** Durable MoneyTransfer evidence with scoped financial references. */
export const MoneyTransfer = pgTable(
  'MoneyTransfer',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sourceAccountId: text().notNull(),
    sourceObjectId: text().notNull(),
    currentObservationId: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    externalId: text().notNull(),
    status: text().notNull(),
    reconciliationBasisHash: text(),
    reconciliationState: text().notNull().default('pending'),
    reconciliationResult: jsonb(),
    reconciledAt: timestamp({ withTimezone: true }),
    sourceAmountMinor: bigint({ mode: 'bigint' }).notNull(),
    sourceCurrency: text().notNull(),
    sourceCurrencyExponent: integer().notNull(),
    destinationAmountMinor: bigint({ mode: 'bigint' }).notNull(),
    destinationCurrency: text().notNull(),
    destinationCurrencyExponent: integer().notNull(),
    destinationBankAccountInstanceId: text(),
    destinationExternalId: text(),
    datePrecision: text().notNull().$type<'instant' | 'date' | 'unknown'>(),
    occurredAt: timestamp({ withTimezone: true }),
    occurredOn: date(),
  },
  (t) => [
    unique('MoneyTransfer_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'MoneyTransfer_record_id_fk',
      columns: [t.organizationId, t.id],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyTransfer_sourceAccountId_fk',
      columns: [t.organizationId, t.sourceAccountId],
      foreignColumns: [FinancialSourceAccount.organizationId, FinancialSourceAccount.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyTransfer_sourceObjectId_fk',
      columns: [t.organizationId, t.sourceObjectId],
      foreignColumns: [FinancialSourceObject.organizationId, FinancialSourceObject.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyTransfer_currentObservationId_fk',
      columns: [t.organizationId, t.currentObservationId],
      foreignColumns: [FinancialSourceObservation.organizationId, FinancialSourceObservation.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'MoneyTransfer_destinationBankAccountInstanceId_fk',
      columns: [t.organizationId, t.destinationBankAccountInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    unique('MoneyTransfer_source_key').on(t.organizationId, t.sourceObjectId),
    check(
      'MoneyTransfer_currency_check',
      sql`${t.sourceCurrency} ~ '^[A-Z]{3}$' AND ${t.destinationCurrency} ~ '^[A-Z]{3}$' AND ${t.sourceCurrencyExponent} BETWEEN 0 AND 4 AND ${t.destinationCurrencyExponent} BETWEEN 0 AND 4`
    ),
    check(
      'MoneyTransfer_date_check',
      sql`(${t.datePrecision} = 'instant' AND ${t.occurredAt} IS NOT NULL AND ${t.occurredOn} IS NULL) OR (${t.datePrecision} = 'date' AND ${t.occurredAt} IS NULL AND ${t.occurredOn} IS NOT NULL) OR (${t.datePrecision} = 'unknown' AND ${t.occurredAt} IS NULL AND ${t.occurredOn} IS NULL)`
    ),
  ]
)
