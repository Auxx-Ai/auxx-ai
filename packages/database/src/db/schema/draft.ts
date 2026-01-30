// packages/database/src/db/schema/draft.ts
// Drizzle table: draft

import {
  pgTable,
  uniqueIndex,
  index,
  text,
  timestamp,
  jsonb,
  sql,
  type AnyPgColumn,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'

import { User } from './user'
import { Organization } from './organization'
import { Thread } from './thread'
import { Message } from './message'
import { Integration } from './integration'

/**
 * Draft table for storing in-progress email drafts.
 * All draft content (recipients, attachments, body) is stored as JSON
 * for fast single-row autosave operations.
 */
export const Draft = pgTable(
  'Draft',
  {
    /** Unique identifier using cuid2 */
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    /** Organization this draft belongs to */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /** User who created this draft */
    createdById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /** Thread this draft belongs to (NULL for new thread drafts) */
    threadId: text().references((): AnyPgColumn => Thread.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    /** Message this draft is replying to (NULL for new threads or forwards) */
    inReplyToMessageId: text().references((): AnyPgColumn => Message.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Integration/inbox used for sending this draft */
    integrationId: text()
      .notNull()
      .references((): AnyPgColumn => Integration.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /**
     * All draft content as JSONB.
     * Structure defined by DraftContent type in packages/types/draft/index.ts
     */
    content: jsonb().notNull().default({}),

    /** Provider draft ID (e.g., Gmail draft ID for synced drafts) */
    providerId: text(),

    /** Provider thread ID (for associating with provider's thread) */
    providerThreadId: text(),

    /** When the draft was created */
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),

    /** When the draft was last updated (auto-updates on change) */
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Organization-scoped queries
    index('Draft_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),

    // User's drafts lookup
    index('Draft_createdById_idx').using('btree', table.createdById.asc().nullsLast()),

    // Thread drafts lookup
    index('Draft_threadId_idx').using('btree', table.threadId.asc().nullsLast()),

    // Integration filtering
    index('Draft_integrationId_idx').using('btree', table.integrationId.asc().nullsLast()),

    // One draft per user per thread constraint
    // For threads, ensures only one draft exists per user per thread
    // NULL threadId allows multiple "new thread" drafts per user
    uniqueIndex('Draft_threadId_createdById_key')
      .using('btree', table.threadId.asc().nullsLast(), table.createdById.asc().nullsLast())
      .where(sql`("threadId" IS NOT NULL)`),

    // Provider sync lookup
    uniqueIndex('Draft_organizationId_providerId_key')
      .using('btree', table.organizationId.asc().nullsLast(), table.providerId.asc().nullsLast())
      .where(sql`("providerId" IS NOT NULL)`),

    // User's drafts for a specific organization (common query pattern)
    index('Draft_organizationId_createdById_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.createdById.asc().nullsLast()
    ),
  ]
)
