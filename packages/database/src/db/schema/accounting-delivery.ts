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

/**
 * The NEUTRAL object vocabulary of the delivery tables (decision D14b).
 *
 * 🛑 These are platform names, not any provider's. `JournalEntry` and `Customer`
 * are Intuit's spellings; Xero calls the same two things `ManualJournal` and
 * `Contact`. Storing a provider's own vocabulary in a provider-agnostic table
 * means a second adapter cannot describe its own objects at all, which is the
 * leak decision D14a forbids.
 *
 * The ADAPTER owns the translation in both directions — see
 * `packages/lib/src/money/quickbooks/object-types.ts`, whose
 * `satisfies Record<DeliveryObjectType, string>` is what proves the map stays
 * exhaustive against this union. Nothing above the `AccountingProvider` seam
 * may hold a provider spelling.
 *
 * ⚠️ Type only, and the CHECK constraints below spell the same five values
 * inline on purpose: `packages/lib` mocks the whole of `@auxx/database` in unit
 * tests, so a RUNTIME export from this file is unreachable there.
 */
export type DeliveryObjectType = 'journal' | 'customer' | 'invoice' | 'payment' | 'credit_memo'

/** Immutable journal representation and its pinned external destination. */
export const AccountingDelivery = pgTable(
  'AccountingDelivery',
  {
    ...identity(),
    bookId: text().notNull(),
    connectionId: text().notNull(),
    glPostingId: text().notNull(),
    representation: text().notNull().$type<'journal' | 'invoice' | 'payment' | 'credit_memo'>(),
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
      sql`${t.representation} IN ('journal','invoice','payment','credit_memo') AND ${t.state} IN ('pending','blocked','delivered')`
    ),
  ]
)

/**
 * Exclusive effect coverage, retained even while export is blocked.
 *
 * 🔑 One row is one COMPONENT of one effect in one book, and the unique key is
 * what makes coverage exclusive: two delivery plans can never claim the same
 * `(book, effect, component)`, so the same accounting contribution cannot be
 * sent twice.
 *
 * 🛑 `componentKey` used to be pinned to `'whole_effect'`, which made a native
 * object covering PART of an effect unrepresentable (plan 53 §5.1). It is now
 * open, and the discipline that replaces the pin is a PARTITION rule: the
 * components of one effect in one book must cover its accepted contribution
 * exactly once — no gaps, no overlap. The CHECK below can only police one row,
 * so the cross-row half is asserted in
 * `packages/lib/src/postings/delivery-coverage.ts` under the accounting commit
 * lock, before anything is sent.
 *
 * `lineKeys` names the `acceptedBasis.contribution[].lineKey`s a partial
 * component carries, and is NULL exactly when the component is the whole
 * effect — the whole-effect path therefore never has to read the basis.
 */
export const AccountingDeliveryCoverage = pgTable(
  'AccountingDeliveryCoverage',
  {
    ...identity(),
    bookId: text().notNull(),
    deliveryId: text().notNull(),
    effectId: text().notNull(),
    componentKey: text().notNull().default('whole_effect'),
    lineKeys: jsonb().$type<string[]>(),
  },
  (t) => [
    unique('AccountingDeliveryCoverage_book_effect_component_key').on(
      t.organizationId,
      t.bookId,
      t.effectId,
      t.componentKey
    ),
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
    check(
      'AccountingDeliveryCoverage_component_check',
      sql`${t.componentKey} ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$' AND ((${t.componentKey} = 'whole_effect' AND ${t.lineKeys} IS NULL) OR (${t.componentKey} <> 'whole_effect' AND jsonb_typeof(${t.lineKeys}) = 'array' AND jsonb_array_length(${t.lineKeys}) > 0))`
    ),
  ]
)

/** Durable request identity, frozen payload and uncertainty state for every remote write. */
export const AccountingDeliveryOperation = pgTable(
  'AccountingDeliveryOperation',
  {
    ...identity(),
    deliveryId: text().notNull(),
    operationKey: text().notNull(),
    objectType: text().notNull().$type<DeliveryObjectType>(),
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
      sql`${t.state} IN ('pending','prepared','sending','uncertain','blocked','succeeded') AND ${t.objectType} IN ('journal','customer','invoice','payment','credit_memo') AND ${t.attempts} >= 0`
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
    objectType: text().notNull().$type<DeliveryObjectType>(),
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
      sql`${t.author} = 'auxx' AND ${t.objectType} IN ('journal','customer','invoice','payment','credit_memo')`
    ),
  ]
)

export type AccountingDeliveryEntity = typeof AccountingDelivery.$inferSelect
export type AccountingDeliveryCoverageEntity = typeof AccountingDeliveryCoverage.$inferSelect
export type AccountingDeliveryOperationEntity = typeof AccountingDeliveryOperation.$inferSelect
