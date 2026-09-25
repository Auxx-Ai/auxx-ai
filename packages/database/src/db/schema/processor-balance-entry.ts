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
    /** Null for types never matched (fee, adjustment, transfers, unknown). */
    matchState: text().$type<'pending' | 'suggested' | 'matched' | 'unmatchable'>(),
    /** The receipt: the match when `matched`, the candidate when `suggested`. */
    matchedMoneyTransactionId: text(),
    /** A code, never free text — the union is mirrored in `@auxx/lib` `money/payouts/match-reasons.ts`. */
    matchReason: text().$type<
      | 'no_receipt'
      | 'no_rail'
      | 'no_reference'
      | 'ambiguous'
      | 'amount_differs'
      | 'rail_differs'
      | 'manual'
    >(),
    /** User id when a person matched or accepted; null for the matcher. */
    matchedBy: text(),
    matchedAt: timestamp({ withTimezone: true }),
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
    // Backs the FK check on an observation delete; without it a bulk delete rescans the org.
    index('ProcessorBalanceEntry_current_observation_idx').on(
      t.organizationId,
      t.currentObservationId
    ),
    index('ProcessorBalanceEntry_payout_idx').on(
      t.organizationId,
      t.sourceAccountId,
      t.payoutExternalId
    ),
    index('ProcessorBalanceEntry_matched_money_idx').on(
      t.organizationId,
      t.matchedMoneyTransactionId
    ),
    // The pending sweep, the receipt-side poke and the "needs matching" filter
    // all read only these three states, so the index skips settled rows.
    index('ProcessorBalanceEntry_open_match_idx')
      .on(t.organizationId, t.matchState)
      .where(sql`${t.matchState} IN ('pending', 'suggested', 'unmatchable')`),
    check(
      'ProcessorBalanceEntry_currency_check',
      sql`${t.currency} ~ '^[A-Z]{3}$' AND ${t.currencyExponent} BETWEEN 0 AND 4`
    ),
  ]
)
