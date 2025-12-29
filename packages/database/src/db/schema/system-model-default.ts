// packages/database/src/db/schema/system-model-default.ts
// Drizzle table: SystemModelDefault

import { pgTable, uniqueIndex, index, text, timestamp, type AnyPgColumn } from './_shared'
import { createId } from '@paralleldrive/cuid2'

import { Organization } from './organization'

/**
 * Stores the default model preference for each ModelType per organization.
 * Used when no specific model is provided for AI operations.
 */
export const SystemModelDefault = pgTable(
  'SystemModelDefault',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** Model type: 'llm', 'text-embedding', 'rerank', etc. */
    modelType: text().notNull(),
    /** Provider identifier: 'openai', 'anthropic', etc. */
    provider: text().notNull(),
    /** Model identifier: 'gpt-4o', 'text-embedding-3-small', etc. */
    model: text().notNull(),
  },
  (table) => [
    // Ensure one default model per modelType per organization
    uniqueIndex('SystemModelDefault_organizationId_modelType_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.modelType.asc().nullsLast()
    ),
    index('SystemModelDefault_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
  ]
)
