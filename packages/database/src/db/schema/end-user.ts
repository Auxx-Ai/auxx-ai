// packages/database/src/db/schema/end-user.ts
// Drizzle table: EndUser

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, jsonb, pgTable, text, timestamp } from './_shared'
import { User } from './user'
import { WorkflowApp } from './workflow-app'

/**
 * End users who access shared workflows
 *
 * Tracks both anonymous visitors and logged-in Auxx users.
 * Persists across multiple workflow runs to enable:
 * - Conversation context for chat workflows
 * - Per-user rate limiting
 * - Analytics (unique visitors vs total runs)
 * - Session continuity when anonymous user logs in
 */
export const EndUser = pgTable(
  'EndUser',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    /** Reference to workflow */
    workflowAppId: text()
      .notNull()
      .references((): AnyPgColumn => WorkflowApp.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /** Cookie-based session identifier (always present) */
    sessionId: text()
      .notNull()
      .$defaultFn(() => createId()),

    /** Linked Auxx user (when logged in) */
    userId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** External ID for embedded scenarios (customer's user ID) */
    externalId: text(),

    /** Context storage for multi-turn workflows (chat, etc.) */
    context: jsonb().$type<Record<string, unknown>>(),

    /** User metadata */
    metadata: jsonb().$type<Record<string, unknown>>().default({}),

    /** Total runs by this end user */
    totalRuns: integer().notNull().default(0),

    /** Last run timestamp */
    lastRunAt: timestamp({ precision: 3 }),

    /** Created timestamp */
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('EndUser_workflowAppId_idx').using('btree', table.workflowAppId.asc().nullsLast()),
    index('EndUser_sessionId_idx').using('btree', table.sessionId.asc().nullsLast()),
    index('EndUser_userId_idx').using('btree', table.userId.asc().nullsLast()),
    index('EndUser_workflowAppId_sessionId_idx').using(
      'btree',
      table.workflowAppId.asc().nullsLast(),
      table.sessionId.asc().nullsLast()
    ),
    index('EndUser_workflowAppId_userId_idx').using(
      'btree',
      table.workflowAppId.asc().nullsLast(),
      table.userId.asc().nullsLast()
    ),
  ]
)
