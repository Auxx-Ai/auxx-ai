// packages/database/src/db/schema/entity-definition.ts
// Drizzle table for EntityDefinition

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { AppInstallation } from './app-installation'
import { CustomField } from './custom-field'
import { DataConnector } from './data-connector'
import { Organization } from './organization'

/**
 * EntityDefinition table for storing custom entity type definitions
 * Allows organizations to create custom entities (e.g., Company, Deal)
 * and link them to existing system tables (Contact, User, Thread, Ticket)
 */
export const EntityDefinition = pgTable(
  'EntityDefinition',
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
    apiSlug: text().notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    color: text().notNull().default('blue'),
    icon: text().notNull().default('Box'),
    singular: text().notNull(),
    plural: text().notNull(),
    /** Entity type: 'standard', 'contact', 'user', 'thread', 'ticket', or null */
    entityType: text(),
    /** Standard type: 'company', 'task', 'deal', 'custom', or null */
    standardType: text(),
    archivedAt: timestamp({ precision: 3 }),

    /** Custom field ID to use as primary display name (e.g., product name) */
    primaryDisplayFieldId: text().references((): AnyPgColumn => CustomField.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Custom field ID to use as secondary info/subtitle (e.g., SKU, price) */
    secondaryDisplayFieldId: text().references((): AnyPgColumn => CustomField.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Custom field ID to use as avatar/image URL */
    avatarFieldId: text().references((): AnyPgColumn => CustomField.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Whether this entity should appear in the sidebar (default: true) */
    isVisible: boolean().notNull().default(true),

    /** Owning DataConnector that provisioned this def (owned-mode only). Stays
     *  NULL for contributing-mode targets and non-connector defs. `set null` on
     *  delete — we never auto-delete the user's CRM defs. */
    dataConnectorId: text().references((): AnyPgColumn => DataConnector.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Owning AppInstallation when this def is installed from an app's record
     *  type. `cascade` on delete — an app-owned def goes away with the app.
     *  NULL for connector-only, template, and user-created defs. */
    appInstallationId: text().references((): AnyPgColumn => AppInstallation.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    /** Stable identity key for the def, scoped by its owner. Double-duty:
     *  - Owned (app/connector): the manifest record-type key (e.g. 'orders') —
     *    the strict adopt/dedupe key, UNIQUE per owner via the partial index.
     *  - Ownerless template: the source templateId (e.g. 'product') — loose,
     *    NON-unique provenance (the installer appends `-2`/`-3` on re-install).
     *  NULL for user-created defs. */
    sourceKey: text(),
  },
  (table) => [
    // Unique constraint: apiSlug must be unique per organization (only for non-archived)
    uniqueIndex('EntityDefinition_apiSlug_organizationId_key')
      .using('btree', table.apiSlug.asc().nullsLast(), table.organizationId.asc().nullsLast())
      .where(sql`${table.archivedAt} IS NULL`),
    // Owner-scoped stable identity: an owned def (app or connector) is one-per-owner
    // per sourceKey. Partial + owner-gated so ownerless template defs (NULL owner)
    // may repeat — the template installer appends `-2`/`-3` and double-install is legal.
    uniqueIndex('EntityDefinition_source_key')
      .using(
        'btree',
        sql`COALESCE(${table.appInstallationId}, '')`,
        sql`COALESCE(${table.dataConnectorId}, '')`,
        table.sourceKey.asc().nullsLast(),
        table.organizationId.asc().nullsLast()
      )
      .where(
        sql`${table.sourceKey} IS NOT NULL AND ${table.archivedAt} IS NULL AND (${table.appInstallationId} IS NOT NULL OR ${table.dataConnectorId} IS NOT NULL)`
      ),
    // Index for organization lookups
    index('EntityDefinition_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    // Index for entityType filtering
    index('EntityDefinition_entityType_idx').using('btree', table.entityType.asc().nullsLast()),
    // Index for archived entities
    index('EntityDefinition_archivedAt_idx').using('btree', table.archivedAt.asc().nullsLast()),
  ]
)

/** Type for selecting from EntityDefinition table */
export type EntityDefinitionEntity = typeof EntityDefinition.$inferSelect

/** Type for inserting into EntityDefinition table */
export type EntityDefinitionInsert = typeof EntityDefinition.$inferInsert
