// packages/database/src/db/schema/financial-source-acceptance.ts
import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { FinancialSourceObject } from './financial-source-object'
import { FinancialSourceObservation } from './financial-source-observation'
import { MoneyTransaction } from './money-transaction'
import { Organization } from './organization'

/** Durable FinancialSourceAcceptance owner; organization deletion cascades, scoped financial references preserve history. */
export const FinancialSourceAcceptance = pgTable(
  'FinancialSourceAcceptance',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sourceObjectId: text().notNull(),
    observationId: text().notNull(),
    state: text().notNull().$type<'pending' | 'accepted' | 'rejected' | 'blocked'>(),
    orderExternalId: text().notNull(),
    orderInstanceId: text(),
    moneyTransactionId: text(),
    unresolvedReferences: jsonb().notNull().default({}),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('FinancialSourceAcceptance_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'FinancialSourceAcceptance_sourceObjectId_fk',
      columns: [t.organizationId, t.sourceObjectId],
      foreignColumns: [FinancialSourceObject.organizationId, FinancialSourceObject.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'FinancialSourceAcceptance_observationId_fk',
      columns: [t.organizationId, t.observationId],
      foreignColumns: [FinancialSourceObservation.organizationId, FinancialSourceObservation.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'FinancialSourceAcceptance_orderInstanceId_fk',
      columns: [t.organizationId, t.orderInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'FinancialSourceAcceptance_moneyTransactionId_fk',
      columns: [t.organizationId, t.moneyTransactionId],
      foreignColumns: [MoneyTransaction.organizationId, MoneyTransaction.id],
    }).onDelete('no action'),
    unique('FinancialSourceAcceptance_object_key').on(t.organizationId, t.sourceObjectId),
    // Backs the FK check on an observation delete; without it a bulk delete rescans the org.
    index('FinancialSourceAcceptance_observation_idx').on(t.organizationId, t.observationId),
    check(
      'FinancialSourceAcceptance_state_check',
      sql`${t.state} IN ('pending','accepted','rejected','blocked')`
    ),
  ]
)
