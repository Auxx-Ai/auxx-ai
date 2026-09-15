// packages/database/src/db/schema/processor-balance-entry.ts
import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
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

/** Durable ProcessorBalanceEntry evidence with scoped financial references. */
export const ProcessorBalanceEntry = pgTable(
  'ProcessorBalanceEntry',
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
    externalId: text().notNull(),
    type: text().notNull(),
    grossMinor: bigint({ mode: 'bigint' }).notNull(),
    feeMinor: bigint({ mode: 'bigint' }).notNull(),
    netMinor: bigint({ mode: 'bigint' }).notNull(),
    currency: text().notNull(),
    currencyExponent: integer().notNull(),
    transactionDate: timestamp({ withTimezone: true }),
    payoutExternalId: text(),
    sourceTransactionId: text(),
    sourceReference: jsonb(),
    sourceOrderId: text(),
    sourceId: text(),
    sourceType: text(),
    isOutgoingTransfer: boolean().notNull(),
  },
  (t) => [
    unique('ProcessorBalanceEntry_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'ProcessorBalanceEntry_record_id_fk',
      columns: [t.organizationId, t.id],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'ProcessorBalanceEntry_sourceAccountId_fk',
      columns: [t.organizationId, t.sourceAccountId],
      foreignColumns: [FinancialSourceAccount.organizationId, FinancialSourceAccount.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'ProcessorBalanceEntry_sourceObjectId_fk',
      columns: [t.organizationId, t.sourceObjectId],
      foreignColumns: [FinancialSourceObject.organizationId, FinancialSourceObject.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'ProcessorBalanceEntry_currentObservationId_fk',
      columns: [t.organizationId, t.currentObservationId],
      foreignColumns: [FinancialSourceObservation.organizationId, FinancialSourceObservation.id],
    }).onDelete('no action'),
    unique('ProcessorBalanceEntry_source_key').on(t.organizationId, t.sourceObjectId),
    index('ProcessorBalanceEntry_payout_idx').on(
      t.organizationId,
      t.sourceAccountId,
      t.payoutExternalId
    ),
    check(
      'ProcessorBalanceEntry_currency_check',
      sql`${t.currency} ~ '^[A-Z]{3}$' AND ${t.currencyExponent} BETWEEN 0 AND 4`
    ),
  ]
)
