// packages/database/src/db/schema/accounting-delivery.ts
import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
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
import { AccountingEffect } from './accounting-effect'
import { ExternalAccountingBook } from './external-accounting-book'
import { ExternalBookConnection } from './external-book-connection'
import { GlPosting } from './gl-posting'
import { Organization } from './organization'

const identity = () => ({
  id: text()
    .primaryKey()
    .$defaultFn(() => createId()),
  organizationId: text()
    .notNull()
    .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

/** Immutable journal representation and its pinned external destination. */
export const AccountingDelivery = pgTable(
  'AccountingDelivery',
  {
    ...identity(),
    bookId: text().notNull(),
    connectionId: text().notNull(),
    glPostingId: text().notNull(),
    representation: text().notNull().$type<'journal'>(),
    state: text().notNull().$type<'pending' | 'blocked' | 'delivered'>(),
    completedAt: timestamp({ withTimezone: true }),
    releasedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique('AccountingDelivery_org_id_key').on(t.organizationId, t.id),
    unique('AccountingDelivery_posting_key').on(t.organizationId, t.bookId, t.glPostingId),
    foreignKey({
      name: 'AccountingDelivery_book_scope_fk',
      columns: [t.organizationId, t.bookId],
      foreignColumns: [ExternalAccountingBook.organizationId, ExternalAccountingBook.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'AccountingDelivery_connection_scope_fk',
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [ExternalBookConnection.organizationId, ExternalBookConnection.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'AccountingDelivery_posting_scope_fk',
      columns: [t.organizationId, t.glPostingId],
      foreignColumns: [GlPosting.organizationId, GlPosting.id],
    }).onDelete('no action'),
    check(
      'AccountingDelivery_shape_check',
      sql`${t.representation} = 'journal' AND ${t.state} IN ('pending','blocked','delivered')`
    ),
  ]
)

/** Exclusive complete-effect coverage, retained even while export is blocked. */
export const AccountingDeliveryCoverage = pgTable(
  'AccountingDeliveryCoverage',
  {
    ...identity(),
    bookId: text().notNull(),
    deliveryId: text().notNull(),
    effectId: text().notNull(),
    componentKey: text().notNull().default('whole_effect'),
  },
  (t) => [
    unique('AccountingDeliveryCoverage_book_effect_key').on(t.organizationId, t.bookId, t.effectId),
    foreignKey({
      name: 'AccountingDeliveryCoverage_book_scope_fk',
      columns: [t.organizationId, t.bookId],
      foreignColumns: [ExternalAccountingBook.organizationId, ExternalAccountingBook.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'AccountingDeliveryCoverage_delivery_scope_fk',
      columns: [t.organizationId, t.deliveryId],
      foreignColumns: [AccountingDelivery.organizationId, AccountingDelivery.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'AccountingDeliveryCoverage_effect_scope_fk',
      columns: [t.organizationId, t.effectId],
      foreignColumns: [AccountingEffect.organizationId, AccountingEffect.id],
    }).onDelete('no action'),
    check('AccountingDeliveryCoverage_component_check', sql`${t.componentKey} = 'whole_effect'`),
  ]
)

/** Durable request identity, frozen payload and uncertainty state for every remote write. */
export const AccountingDeliveryOperation = pgTable(
  'AccountingDeliveryOperation',
  {
    ...identity(),
    deliveryId: text().notNull(),
    operationKey: text().notNull(),
    objectType: text().notNull().$type<'JournalEntry' | 'Customer'>(),
    requestId: text().notNull(),
    state: text()
      .notNull()
      .$type<'pending' | 'prepared' | 'sending' | 'uncertain' | 'blocked' | 'succeeded'>(),
    payload: jsonb().$type<Record<string, unknown>>(),
    payloadHash: text(),
    mappingBasis: jsonb(),
    dependencies: jsonb().notNull().$type<string[]>().default([]),
    firstSentAt: timestamp({ withTimezone: true }),
    leaseToken: text(),
    leaseExpiresAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }),
    failureReason: text(),
    outcome: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [
    unique('AccountingDeliveryOperation_org_id_key').on(t.organizationId, t.id),
    unique('AccountingDeliveryOperation_key').on(t.organizationId, t.deliveryId, t.operationKey),
    unique('AccountingDeliveryOperation_request_key').on(t.organizationId, t.requestId),
    foreignKey({
      name: 'AccountingDeliveryOperation_delivery_scope_fk',
      columns: [t.organizationId, t.deliveryId],
      foreignColumns: [AccountingDelivery.organizationId, AccountingDelivery.id],
    }).onDelete('no action'),
    check(
      'AccountingDeliveryOperation_state_check',
      sql`${t.state} IN ('pending','prepared','sending','uncertain','blocked','succeeded') AND ${t.objectType} IN ('JournalEntry','Customer') AND ${t.attempts} >= 0`
    ),
    check(
      'AccountingDeliveryOperation_payload_check',
      sql`((${t.payload} IS NULL AND ${t.payloadHash} IS NULL AND ${t.firstSentAt} IS NULL) OR (${t.payload} IS NOT NULL AND ${t.payloadHash} ~ '^[0-9a-f]{64}$')) IS TRUE`
    ),
    index('AccountingDeliveryOperation_recovery_idx').on(t.state, t.nextAttemptAt),
  ]
)

/** Remote identity and verified accounting basis; remote IDs are company and type scoped. */
export const ExternalAccountingObject = pgTable(
  'ExternalAccountingObject',
  {
    ...identity(),
    bookId: text().notNull(),
    operationId: text().notNull(),
    objectType: text().notNull().$type<'JournalEntry' | 'Customer'>(),
    externalId: text().notNull(),
    author: text().notNull().$type<'auxx'>(),
    remoteVersion: text(),
    remoteBasis: jsonb().notNull(),
    componentCoverage: jsonb().notNull().$type<string[]>(),
  },
  (t) => [
    unique('ExternalAccountingObject_remote_key').on(
      t.organizationId,
      t.bookId,
      t.objectType,
      t.externalId
    ),
    unique('ExternalAccountingObject_operation_key').on(t.organizationId, t.operationId),
    foreignKey({
      name: 'ExternalAccountingObject_book_scope_fk',
      columns: [t.organizationId, t.bookId],
      foreignColumns: [ExternalAccountingBook.organizationId, ExternalAccountingBook.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'ExternalAccountingObject_operation_scope_fk',
      columns: [t.organizationId, t.operationId],
      foreignColumns: [AccountingDeliveryOperation.organizationId, AccountingDeliveryOperation.id],
    }).onDelete('no action'),
    check(
      'ExternalAccountingObject_shape_check',
      sql`${t.author} = 'auxx' AND ${t.objectType} IN ('JournalEntry','Customer')`
    ),
  ]
)

export type AccountingDeliveryEntity = typeof AccountingDelivery.$inferSelect
export type AccountingDeliveryOperationEntity = typeof AccountingDeliveryOperation.$inferSelect
