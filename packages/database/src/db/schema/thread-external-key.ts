// packages/database/src/db/schema/thread-external-key.ts
// Drizzle table for ThreadExternalKey — provider conversation keys aliased to a Thread

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { Integration } from './integration'
import { Thread } from './thread'

/**
 * Maps every provider conversation key we have ever seen to a single thread —
 * one thread, many external ids.
 *
 * `Thread.externalId` remains the canonical/first key, but it cannot be the only
 * one: Microsoft Graph assigns a *fresh* `conversationId` to an inbound reply to
 * a message we sent, and Microsoft explicitly documents that `conversationId`
 * must not be relied on for threading. Keyed solely on it, a single conversation
 * forks into two threads on the first send→reply round-trip.
 *
 * Aliases are what make a merge stick. Once a message has been re-attached to the
 * right thread via the RFC 5322 parentage chain, its (new) conversation key is
 * recorded here so every subsequent message in the forked conversation resolves
 * directly, without needing a resolvable parent of its own.
 */
export const ThreadExternalKey = pgTable(
  'ThreadExternalKey',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    threadId: text()
      .notNull()
      .references((): AnyPgColumn => Thread.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    integrationId: text()
      .notNull()
      .references((): AnyPgColumn => Integration.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Provider conversation key (Graph `conversationId`, Gmail `threadId`, …). */
    externalId: text().notNull(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // Mirrors `Thread_integrationId_externalId_key`, but NOT NULL on both columns:
    // a provider key resolves to exactly one thread within an integration.
    uniqueIndex('ThreadExternalKey_integrationId_externalId_key').using(
      'btree',
      table.integrationId.asc().nullsLast(),
      table.externalId.asc().nullsLast()
    ),
    index('ThreadExternalKey_threadId_idx').using('btree', table.threadId.asc().nullsLast()),
  ]
)

export type ThreadExternalKeyEntity = typeof ThreadExternalKey.$inferSelect
export type ThreadExternalKeyInsert = typeof ThreadExternalKey.$inferInsert
