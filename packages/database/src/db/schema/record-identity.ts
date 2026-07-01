// packages/database/src/db/schema/record-identity.ts
// Drizzle table: RecordIdentity — write-through reverse-lookup index for
// cross-system record identities. See plans/data-connectors/v7/option-3-multi-source-identity-store-plan.md

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, sql, text, timestamp, uniqueIndex } from './_shared'
import { AppInstallation } from './app-installation'
import { Credential } from './credential'
import { CustomField } from './custom-field'
import { EntityDefinition } from './entity-definition'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'

/**
 * Write-through index mirroring identity-flagged `FieldValue` cells (plus
 * app-less links like chat `visitorId`) for reverse lookup, cross-store/
 * cross-app resolution, and the "linked systems" display. Never the source
 * of truth for the value — that stays in `FieldValue`. See the plan doc for
 * the full write-ownership + reconcile contract.
 */
export const RecordIdentity = pgTable(
  'RecordIdentity',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /** The linked record. Cascades so deleting a record drops its index rows. */
    entityInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Indexed resolution by kind — `RecordIdentity` is entity-agnostic. */
    entityDefinitionId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Universal namespace — app slug (`'shopify'`, `'hubspot'`) or `'chat'`. */
    source: text().notNull(),

    /** App-origin links. NULL for app-less links (chat). Cascades on hard
     *  uninstall cleanup, but uninstall is a soft-delete first — app-origin
     *  rows also need explicit cleanup in the uninstall transaction. */
    appInstallationId: text().references((): AnyPgColumn => AppInstallation.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    /** Which connected store/account. NULL for installation-scoped links and
     *  platform (chat) links. Cascades when the Credential is hard-deleted. */
    connectionId: text().references((): AnyPgColumn => Credential.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    /** The id kind, e.g. `'customerId'`. NULL for bare-source links
     *  (chat `visitorId`). */
    appFieldKey: text(),

    /** The `FieldValue` cell this row mirrors. NULL for app-less links that
     *  have no `CustomField` (chat `visitorId`). Cascades so a deleted
     *  identity-flagged field drops its mirror rows. */
    fieldId: text().references((): AnyPgColumn => CustomField.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    /** The value — denormalized for index-only reverse lookup (numeric
     *  Shopify id, chat visitor id, …). */
    externalId: text().notNull(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Cross-store / cross-app reverse lookup: "find the record for source id
    // X regardless of store/app" — backs findByIntegrationId's entity-scoped form.
    index('RecordIdentity_org_def_source_externalId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast(),
      table.source.asc().nullsLast(),
      table.externalId.asc().nullsLast()
    ),
    // Connection-scoped resolution — e.g. chat JWT resolving a Shopify
    // customerId within one store.
    index('RecordIdentity_org_source_conn_field_externalId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.source.asc().nullsLast(),
      table.connectionId.asc().nullsLast(),
      table.appFieldKey.asc().nullsLast(),
      table.externalId.asc().nullsLast()
    ),
    // Batch loader for the "linked systems" display (one query per page of records).
    index('RecordIdentity_entityInstanceId_idx').using(
      'btree',
      table.entityInstanceId.asc().nullsLast()
    ),
    // One identity -> one record. connectionId/appFieldKey COALESCE'd so NULLs
    // (installation-scoped / bare-source links) still collide correctly.
    uniqueIndex('RecordIdentity_identity_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.source.asc().nullsLast(),
      sql`COALESCE(${table.connectionId}, '')`,
      sql`COALESCE(${table.appFieldKey}, '')`,
      table.externalId.asc().nullsLast()
    ),
    // No duplicate id-kind per record (a record can't carry two different
    // Shopify customerIds for the same store).
    uniqueIndex('RecordIdentity_record_kind_key').using(
      'btree',
      table.entityInstanceId.asc().nullsLast(),
      table.source.asc().nullsLast(),
      sql`COALESCE(${table.connectionId}, '')`,
      sql`COALESCE(${table.appFieldKey}, '')`
    ),
  ]
)

/** Selected RecordIdentity entity type */
export type RecordIdentityEntity = typeof RecordIdentity.$inferSelect

/** Insert RecordIdentity entity type */
export type RecordIdentityInsert = typeof RecordIdentity.$inferInsert
