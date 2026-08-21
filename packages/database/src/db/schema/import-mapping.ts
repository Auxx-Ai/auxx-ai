// packages/database/src/db/schema/import-mapping.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, text, timestamp } from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * ImportMapping - Reusable import mapping template
 * Defines how CSV columns map to entity fields
 */
export const ImportMapping = pgTable(
  'ImportMapping',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),

    // Organization scope
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /**
     * Entity to import data into.
     * - For system resources: 'contact', 'ticket', 'user', etc.
     * - For custom entities: EntityDefinition UUID (e.g., 'cm1abc123...')
     *
     * Note: No FK constraint since system resources don't have EntityDefinition records.
     */
    entityDefinitionId: text().notNull(),

    // User-friendly name for this mapping template
    title: text().notNull(),

    // Source file type (currently only 'csv')
    sourceType: text().notNull().default('csv'),

    /**
     * What an import does with a row once the identifier has (or has not)
     * matched an existing record. Plain `text()` with no enum constraint,
     * the union lives in `@auxx/lib/import/types/mapping`.
     *
     *   'create'          , always create; the identifier is ignored entirely
     *   'update'          , update matched rows; unmatched rows are reported
     *                        as UNMATCHED (distinct from a row error)
     *   'create-or-update', update matched, create unmatched (upsert)
     *
     * Defaults to 'create'; the wizard flips it to 'create-or-update' once an
     * identifier column is chosen. The old 'skip' member was retired, `skip`
     * remains a per-ROW strategy, never a job-level mode.
     */
    defaultStrategy: text().notNull().default('create'),

    /**
     * Ordered field keys forming the match key used for duplicate detection.
     *
     * One key is the ordinary case (`sku`, `email`). More than one is a
     * COMPOSITE key, ANDed, `['part', 'supplier']` is what makes a supplier
     * price list re-importable, since `vendor_part` has no single unique field
     * by design (a vendor SKU is unique within a supplier, not org-wide).
     *
     * Derived from the per-column `identityRole: { kind: 'match' }` markers on
     * `ImportMappingProperty.resolutionConfig`, that is the source of truth a
     * user edits; this column is the planner's read shape. It MUST be
     * rewritten whenever a column is unmapped or retargeted: a stale key whose
     * field has no mapped column makes `analyzeRow` find no identifier value,
     * and the import silently reverts to create-only behind a wizard that says
     * update is on.
     *
     * Replaces the singular `identifierFieldKey`, which had no writer anywhere
     * in the codebase and was NULL on every row in every org.
     */
    identifierFieldKeys: text().array(),

    // Creator
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('ImportMapping_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    index('ImportMapping_entityDefinitionId_idx').using(
      'btree',
      table.entityDefinitionId.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from ImportMapping table */
export type ImportMappingEntity = typeof ImportMapping.$inferSelect

/** Type for inserting into ImportMapping table */
export type ImportMappingInsert = typeof ImportMapping.$inferInsert
