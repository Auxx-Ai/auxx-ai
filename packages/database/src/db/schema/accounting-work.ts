// packages/database/src/db/schema/accounting-work.ts

import { createId } from '@paralleldrive/cuid2'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from './_shared'
import { AccountingEffect } from './accounting-effect'
import { EntityInstance } from './entity-instance'
import { MoneyTransaction } from './money-transaction'
import { Organization } from './organization'

/** Durable AccountingWork identity for accounting acceptance and recovery. */
export const AccountingWork = pgTable(
  'AccountingWork',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    entityInstanceId: text(),
    moneyTransactionId: text(),
    effectKind: text()
      .notNull()
      .$type<
        'fulfillment_accounting' | 'customer_receipt' | 'customer_credit_issued' | 'customer_refund'
      >(),
    componentKey: text().notNull().default('original'),
    effectKey: text().notNull(),
    operation: text().notNull().$type<'original' | 'correction'>(),
    correctsEffectId: text(),
    basisVersion: integer().notNull(),
    state: text().notNull().$type<'pending' | 'blocked' | 'accepted' | 'no_effect' | 'canceled'>(),
    eligibility: text().notNull().$type<'automatic' | 'manual' | 'excluded'>(),
    blockedReason: text(),
    nextAttemptAt: timestamp({ withTimezone: true }),
    leaseUntil: timestamp({ withTimezone: true }),
    leaseToken: text(),
    attempts: integer().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('AccountingWork_org_id_key').on(t.organizationId, t.id),
    unique('AccountingWork_org_effect_key').on(t.organizationId, t.effectKey),
    uniqueIndex('AccountingWork_fulfillment_original_key')
      .on(t.organizationId, t.entityInstanceId, t.effectKind)
      .where(sql`${t.operation} = 'original'`),
    uniqueIndex('AccountingWork_money_original_key')
      .on(t.organizationId, t.moneyTransactionId, t.effectKind)
      .where(sql`${t.operation} = 'original'`),
    foreignKey({
      name: 'AccountingWork_entity_scope_fk',
      columns: [t.organizationId, t.entityInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'AccountingWork_money_scope_fk',
      columns: [t.organizationId, t.moneyTransactionId],
      foreignColumns: [MoneyTransaction.organizationId, MoneyTransaction.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'AccountingWork_correction_scope_fk',
      columns: [t.organizationId, t.correctsEffectId],
      foreignColumns: [AccountingEffect.organizationId, AccountingEffect.id],
    }).onDelete('no action'),
    check(
      'AccountingWork_kind_check',
      sql`(${t.effectKind} IN ('fulfillment_accounting', 'customer_credit_issued') AND ${t.entityInstanceId} IS NOT NULL AND ${t.moneyTransactionId} IS NULL) OR (${t.effectKind} IN ('customer_receipt', 'customer_refund') AND ${t.moneyTransactionId} IS NOT NULL AND ${t.entityInstanceId} IS NULL)`
    ),
    check(
      'AccountingWork_correction_check',
      sql`(${t.operation} = 'original' AND ${t.correctsEffectId} IS NULL AND ${t.componentKey} = 'original') OR (${t.operation} = 'correction' AND ${t.correctsEffectId} IS NOT NULL)`
    ),
    check(
      'AccountingWork_state_check',
      sql`${t.state} IN ('pending', 'blocked', 'accepted', 'no_effect', 'canceled')`
    ),
    check(
      'AccountingWork_eligibility_check',
      sql`${t.eligibility} IN ('automatic', 'manual', 'excluded')`
    ),
    check('AccountingWork_version_check', sql`${t.basisVersion} > 0 AND ${t.attempts} >= 0`),
    check('AccountingWork_lease_check', sql`(${t.leaseUntil} IS NULL) = (${t.leaseToken} IS NULL)`),
    index('AccountingWork_retry_idx').on(t.organizationId, t.state, t.eligibility, t.nextAttemptAt),
  ]
)

export type AccountingWorkEntity = typeof AccountingWork.$inferSelect
