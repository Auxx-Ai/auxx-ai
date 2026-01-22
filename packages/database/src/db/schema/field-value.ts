// packages/database/src/db/schema/field-value.ts
// Drizzle table for FieldValue - typed field value storage for unified entity architecture

import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
  doublePrecision,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { CustomField } from './custom-field'
import { Organization } from './organization'
import { User } from './user'

/**
 * FieldValue stores typed field values with support for multi-value fields.
 *
 * Design decisions:
 * - Each row stores ONE value (multi-value fields = multiple rows with same entityId+fieldId)
 * - sortKey uses fractional indexing for efficient reordering (no renumbering required)
 * - organizationId denormalized for faster queries without JOIN
 * - Only ONE typed column is populated per row (based on field type)
 */
export const FieldValue = pgTable(
  'FieldValue',
  {
    /** Primary key */
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),

    /** Timestamp when created */
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),

    /** Timestamp when last updated (uses $defaultFn since column lacks DB default) */
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),

    /** Organization this value belongs to (denormalized for query performance) */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),

    /** Reference to the field definition */
    fieldId: text()
      .notNull()
      .references((): AnyPgColumn => CustomField.id, { onDelete: 'cascade' }),

    /** Entity ID (Contact, Ticket, EntityInstance, or other entity) */
    entityId: text().notNull(),

    /** Entity definition ID (system type like "contact" or custom entity UUID) */
    entityDefinitionId: text().notNull(),

    // ========================================
    // Typed value columns (only ONE populated per row)
    // ========================================

    /** Text value for TEXT, RICH_TEXT, NAME, EMAIL, URL, PHONE_INTL fields */
    valueText: text(),

    /** Numeric value for NUMBER, CURRENCY fields */
    valueNumber: doublePrecision(),

    /** Boolean value for CHECKBOX fields */
    valueBoolean: boolean(),

    /** Date/time value for DATE, DATETIME, TIME fields (with timezone for correct UTC handling) */
    valueDate: timestamp({ precision: 3, withTimezone: true, mode: 'string' }),

    /** JSON value for FILE, CURRENCY (with code), ADDRESS_STRUCT, and complex types */
    valueJson: jsonb(),

    // ========================================
    // Reference columns
    // ========================================

    /** Option ID for SINGLE_SELECT, MULTI_SELECT - references option.id in field options */
    optionId: text(),

    /** Related entity ID for RELATIONSHIP fields */
    relatedEntityId: text(),

    /** Related entity definition ID for RELATIONSHIP fields (UUID or system resource name like "contacts") */
    relatedEntityDefinitionId: text(),

    /** Actor ID for ACTOR fields - references User.id when actorType is 'user' */
    actorId: text().references((): AnyPgColumn => User.id, { onDelete: 'set null' }),

    // ========================================
    // Multi-value ordering
    // ========================================

    /**
     * Sort key for multi-value field ordering (fractional indexing)
     * Examples: "a", "aV", "aVV", "n" - allows insertion between any two values
     */
    sortKey: text().notNull().default('a'),
  },
  (table) => [
    // Primary lookups
    index('FieldValue_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('FieldValue_entityId_idx').using('btree', table.entityId.asc().nullsLast()),
    index('FieldValue_entityDefinitionId_idx').using(
      'btree',
      table.entityDefinitionId.asc().nullsLast()
    ),
    index('FieldValue_fieldId_idx').using('btree', table.fieldId.asc().nullsLast()),
    index('FieldValue_entityId_fieldId_idx').using(
      'btree',
      table.entityId.asc().nullsLast(),
      table.fieldId.asc().nullsLast()
    ),
    index('FieldValue_entityDefinitionId_entityId_idx').using(
      'btree',
      table.entityDefinitionId.asc().nullsLast(),
      table.entityId.asc().nullsLast()
    ),

    // Option and relationship lookups
    index('FieldValue_optionId_idx').using('btree', table.optionId.asc().nullsLast()),
    index('FieldValue_relatedEntityId_idx').using('btree', table.relatedEntityId.asc().nullsLast()),
    index('FieldValue_relatedEntityDefinitionId_idx').using(
      'btree',
      table.relatedEntityDefinitionId.asc().nullsLast()
    ),

    // Actor lookups
    index('FieldValue_actorId_idx').using('btree', table.actorId.asc().nullsLast()),

    // Unique per sortKey (allows multi-value with ordering)
    uniqueIndex('FieldValue_entity_field_sortKey_key').using(
      'btree',
      table.entityId.asc().nullsLast(),
      table.fieldId.asc().nullsLast(),
      table.sortKey.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from FieldValue table */
export type FieldValueEntity = typeof FieldValue.$inferSelect

/** Type for inserting into FieldValue table */
export type FieldValueInsert = typeof FieldValue.$inferInsert
