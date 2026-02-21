// packages/database/src/db/schema/key-value-pair.ts
// Multi-scope key-value store for system config overrides and user variables

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'

import { Organization } from './organization'
import { User } from './user'

/**
 * Multi-scope key-value store.
 * Handles system config variables, org-level overrides, and user variables.
 *
 * Scope is determined by the combination of type + organizationId + userId:
 * - CONFIG_VARIABLE with both NULL → system-wide config
 * - CONFIG_VARIABLE with orgId set → org-level config override
 * - USER_VARIABLE with userId set → user preference (optionally org-scoped)
 */
export const KeyValuePair = pgTable(
  'KeyValuePair',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    /** The key name, e.g. 'OPENAI_API_KEY' or 'theme' */
    key: text().notNull(),
    /** The stored value — plaintext JSON for non-sensitive, encrypted string for sensitive */
    value: jsonb().notNull(),
    /** Discriminator: CONFIG_VARIABLE or USER_VARIABLE */
    type: text().notNull(),
    /** Whether this value is encrypted */
    isEncrypted: text().default('false').notNull(),
    /** Organization scope — NULL for system-wide config or global user prefs */
    organizationId: text().references((): AnyPgColumn => Organization.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    /** User scope — NULL for system/org config variables */
    userId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    /** Who last updated this value */
    updatedById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // General uniqueness: one value per (key, userId, organizationId) combination
    uniqueIndex('KeyValuePair_key_userId_organizationId_key').using(
      'btree',
      table.key.asc().nullsLast(),
      table.userId.asc().nullsLast(),
      table.organizationId.asc().nullsLast()
    ),
    // System/org-level entries: unique (key, organizationId) when userId IS NULL
    uniqueIndex('KeyValuePair_key_organizationId_null_userId_key')
      .using('btree', table.key.asc().nullsLast(), table.organizationId.asc().nullsLast())
      .where(sql`"userId" IS NULL`),
    // Global user entries: unique (key, userId) when organizationId IS NULL
    uniqueIndex('KeyValuePair_key_userId_null_organizationId_key')
      .using('btree', table.key.asc().nullsLast(), table.userId.asc().nullsLast())
      .where(sql`"organizationId" IS NULL`),
    // System-level entries: unique (key) when both userId and organizationId are NULL
    uniqueIndex('KeyValuePair_key_system_unique')
      .using('btree', table.key.asc().nullsLast())
      .where(sql`"userId" IS NULL AND "organizationId" IS NULL`),
    // Lookup indexes
    index('KeyValuePair_type_idx').using('btree', table.type.asc().nullsLast()),
    index('KeyValuePair_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('KeyValuePair_userId_idx').using('btree', table.userId.asc().nullsLast()),
  ]
)

/** Select type */
export type KeyValuePairEntity = typeof KeyValuePair.$inferSelect
/** Insert type */
export type KeyValuePairInsert = typeof KeyValuePair.$inferInsert
