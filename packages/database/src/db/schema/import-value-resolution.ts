// packages/database/src/db/schema/import-value-resolution.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  importResolutionStatus,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { ImportJobProperty } from './import-job-property'

/**
 * ImportValueResolution - Cached value resolutions
 * Each unique value (by hash) is resolved once and cached
 */
export const ImportValueResolution = pgTable(
  'ImportValueResolution',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),

    // Parent job property (links to column mapping)
    importJobPropertyId: text()
      .notNull()
      .references((): AnyPgColumn => ImportJobProperty.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    // SHA256 hash of the raw value (for deduplication)
    hashedValue: text().notNull(),

    // Original raw value from CSV
    rawValue: text().notNull(),

    // How many cells have this value
    cellCount: integer().notNull().default(1),

    // Resolution result (JSON array)
    // [{ type: 'value' | 'error' | 'warning' | 'create', value?, error?, warning? }]
    resolvedValues: jsonb().notNull(),

    // Overall resolution status
    status: importResolutionStatus().notNull().default('pending'),

    // Is the resolution valid (no errors)?
    isValid: boolean().notNull().default(true),

    // Error message if resolution failed
    errorMessage: text(),

    // User override (if manually corrected)
    userOverride: jsonb(),
    overriddenAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('ImportValueResolution_importJobPropertyId_idx').using(
      'btree',
      table.importJobPropertyId.asc().nullsLast()
    ),
    uniqueIndex('ImportValueResolution_propertyId_hash_key').using(
      'btree',
      table.importJobPropertyId.asc().nullsLast(),
      table.hashedValue.asc().nullsLast()
    ),
    index('ImportValueResolution_status_idx').using(
      'btree',
      table.importJobPropertyId.asc().nullsLast(),
      table.status.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from ImportValueResolution table */
export type ImportValueResolutionEntity = typeof ImportValueResolution.$inferSelect

/** Type for inserting into ImportValueResolution table */
export type ImportValueResolutionInsert = typeof ImportValueResolution.$inferInsert
