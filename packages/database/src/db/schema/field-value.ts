// packages/database/src/db/schema/field-value.ts
// Drizzle table for FieldValue - typed field value storage for unified entity architecture

import { createId } from '@paralleldrive/cuid2'
import { textCollateC } from './_collations'
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { CustomField } from './custom-field'
import { DataConnector } from './data-connector'
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
     * Sort key for multi-value field ordering (fractional indexing).
     * Examples: "a", "aV", "aVV", "n" - allows insertion between any two values.
     * Uses C (byte-order) collation so MAX/ORDER BY match the lib's `0…9<A…Z<a…z` order.
     */
    sortKey: textCollateC().notNull().default('a'),

    // ========================================
    // AI generation marker (nullable for non-AI values)
    // ========================================

    /**
     * AI generation state for this value row.
     * NULL => value is not AI-generated (or marker was cleared by manual edit).
     * Values: 'generating' | 'result' | 'error'.
     * 'stale' is derived at read time (by comparing valueJson.inputHash to
     * the live reference hash), not persisted.
     *
     * AI metadata (model, generatedAt, inputHash, jobId, errorMessage,
     * tokens) piggy-backs on the existing valueJson column; safe because no
     * AI-eligible field type in v1 writes its own value to valueJson.
     */
    aiStatus: text(),

    // ========================================
    // Data-connector provenance (contributing mode only)
    // ========================================

    /**
     * Contributing data connector that wrote/manages this value (per-cell
     * marker; NULL for user/AI/owned values). Drives the "Synced by <connector>
     * — may be overwritten on next sync" badge on an otherwise-editable cell.
     *
     * Contributing values always belong to the user's own record, so `set null`
     * is the only correct connector-delete behavior — the FK nulls the marker
     * automatically with no teardown sweep, and the user's record is never
     * touched. Mirrors the sibling provenance column `CustomField.dataConnectorId`
     * (owned mode). The render-time merge-strategy copy is resolved from the
     * connector's cached mapping, so there is no `mergeStrategy` column here.
     */
    managedByConnectorId: text().references((): AnyPgColumn => DataConnector.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
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

    // Composite: inventory QoH self-join (orgId + fieldId + relatedEntityId)
    index('FieldValue_orgId_fieldId_relatedEntityId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.fieldId.asc().nullsLast(),
      table.relatedEntityId.asc().nullsLast()
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

    // Partial indexes for `lookupByField` — one per typed column. Without
    // these, equality lookups on FieldValue.valueText etc. are Seq Scans
    // against a table that grows with `entities × fields_per_entity`.
    // Partial so write-path cost stays at one index update per row
    // (only the column this row populates).
    index('FieldValue_lookup_text_idx')
      .using(
        'btree',
        table.organizationId.asc().nullsLast(),
        table.fieldId.asc().nullsLast(),
        table.valueText.asc().nullsLast()
      )
      .where(sql`"valueText" IS NOT NULL`),
    // Case-insensitive sibling of the index above. The importer's identifier
    // lookup opts into `caseInsensitiveText`, which makes
    // `lookup-entities-by-field-value.ts` compare `lower("valueText") = $1`.
    // A btree on the bare column cannot serve that predicate as an index
    // condition, so without this the planner range-scans the
    // `(organizationId, fieldId)` prefix and applies `lower()` as a filter —
    // reading every stored value of that field in the org, once per row of the
    // CSV.
    //
    // The expression must stay byte-identical (modulo table qualification,
    // which Postgres ignores when matching) to the one the lookup emits. A
    // `lower(trim(...))` or a differing collation silently stops matching and
    // the scan comes back.
    index('FieldValue_lookup_lower_text_idx')
      .using(
        'btree',
        table.organizationId.asc().nullsLast(),
        table.fieldId.asc().nullsLast(),
        sql`lower("valueText")`
      )
      .where(sql`"valueText" IS NOT NULL`),
    index('FieldValue_lookup_number_idx')
      .using(
        'btree',
        table.organizationId.asc().nullsLast(),
        table.fieldId.asc().nullsLast(),
        table.valueNumber.asc().nullsLast()
      )
      .where(sql`"valueNumber" IS NOT NULL`),
    index('FieldValue_lookup_option_idx')
      .using(
        'btree',
        table.organizationId.asc().nullsLast(),
        table.fieldId.asc().nullsLast(),
        table.optionId.asc().nullsLast()
      )
      .where(sql`"optionId" IS NOT NULL`),
    index('FieldValue_lookup_related_idx')
      .using(
        'btree',
        table.organizationId.asc().nullsLast(),
        table.fieldId.asc().nullsLast(),
        table.relatedEntityId.asc().nullsLast()
      )
      .where(sql`"relatedEntityId" IS NOT NULL`),
    index('FieldValue_lookup_actor_idx')
      .using(
        'btree',
        table.organizationId.asc().nullsLast(),
        table.fieldId.asc().nullsLast(),
        table.actorId.asc().nullsLast()
      )
      .where(sql`"actorId" IS NOT NULL`),
    index('FieldValue_lookup_date_idx')
      .using(
        'btree',
        table.organizationId.asc().nullsLast(),
        table.fieldId.asc().nullsLast(),
        table.valueDate.asc().nullsLast()
      )
      .where(sql`"valueDate" IS NOT NULL`),

    // Substring search over stored field VALUES — the only way to find a record
    // by a value it holds (plans/email-editor/recipient-search.md §4.4).
    //
    // `EntityInstance.searchText` is `displayName + secondaryDisplayValue` and
    // nothing else (`resources/search/record-search-sql.ts:14-18`), so record
    // text search cannot match a field value. Measured: a 7-digit phone query
    // against the full record text predicate matched **0 rows** over 100k
    // contacts that all had phone numbers. With this index, `FieldValue`-first
    // answers the same query in **0.30 ms** over 200k rows.
    //
    // **This is the one index here whose write cost is worth watching.** The
    // five `FieldValue_lookup_*_idx` above are plain btrees; a GIN trigram index
    // is not comparable, and this one covers EVERY `valueText` row, not just the
    // identifier-bearing ones — on the dev DB that is 1 957 identifier values
    // out of 39 234 rows, so it carries ~20x the rows it exists for. It cannot
    // be narrowed: `entityDefinitionId` holds a per-org CUID rather than the
    // literal `'contact'` its comment suggests, and `CustomField.type` is a join
    // away and unreachable from an index predicate. Accepted deliberately,
    // because the alternative is a recipient search that cannot find a phone
    // number. Re-measure write latency on a bulk import; if it bites, the escape
    // hatch is a dedicated identifier-lookup table, not a narrower index.
    //
    // Partial on the same principle as the lookup indexes: one index update per
    // row, only for rows that populate this column.
    index('FieldValue_org_field_valueText_trgm_idx')
      .using('gin', table.organizationId, table.fieldId, table.valueText.op('gin_trgm_ops'))
      .where(sql`"valueText" IS NOT NULL`),
  ]
)

/** Type for selecting from FieldValue table */
export type FieldValueEntity = typeof FieldValue.$inferSelect

/** Type for inserting into FieldValue table */
export type FieldValueInsert = typeof FieldValue.$inferInsert
