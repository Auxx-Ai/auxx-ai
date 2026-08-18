// packages/database/src/db/schema/thread-event.ts
// Drizzle table: threadEvent

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp } from './_shared'
import { Organization } from './organization'
import { Thread } from './thread'

/**
 * Drizzle table for threadEvent — the thread lifecycle event log.
 *
 * Boundary rule (plans/threads/thread-events.md §5): ThreadEvent =
 * conversation-surface events rendered inline between message bubbles;
 * TimelineEvent = record-surface history. TimelineEvent merge markers are the
 * mechanism, ThreadEvent is the surface.
 *
 * Rows are append-only — there is deliberately no `updatedAt`. `type` is free
 * text pinned by the `THREAD_EVENT_TYPES` const in
 * `@auxx/lib/thread-events/client` (two of the strings are public webhook event
 * names, so the vocabulary's stability is an API contract, not a pgEnum).
 * `actorId` holds a branded `ActorId` string (`user:abc`, `agent:xyz`); null
 * for system/automation actors, whose provenance lives in `data.source`.
 */
export const ThreadEvent = pgTable(
  'ThreadEvent',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    threadId: text()
      .notNull()
      .references((): AnyPgColumn => Thread.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    type: text().notNull(),
    /** Branded ActorId string ('user:abc' / 'agent:xyz'); null for system/automation. */
    actorId: text(),
    data: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // Serves the per-thread timeline read (filter + order, no sort node).
    index('ThreadEvent_thread_idx').using(
      'btree',
      table.threadId.asc().nullsLast(),
      table.createdAt.asc().nullsLast()
    ),
    // Org-wide "recent events of type X" lookups.
    index('ThreadEvent_org_type_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.type.asc().nullsLast(),
      table.createdAt.desc().nullsFirst()
    ),
  ]
)

/** Selected ThreadEvent entity type */
export type ThreadEventEntity = typeof ThreadEvent.$inferSelect
/** Insert shape for ThreadEvent */
export type CreateThreadEventInput = typeof ThreadEvent.$inferInsert
