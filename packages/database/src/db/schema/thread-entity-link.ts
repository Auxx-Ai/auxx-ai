// packages/database/src/db/schema/thread-entity-link.ts
// Drizzle table for ThreadEntityLink — secondary entity links from a Thread

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, sql, text, timestamp, uniqueIndex } from './_shared'
import { EntityDefinition } from './entity-definition'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { Thread } from './thread'
import { User } from './user'

/**
 * Secondary thread→entity links. The primary link lives on `Thread.primaryEntityInstanceId`;
 * any additional entity associations (e.g. a thread that touches a Deal AND a related Account)
 * are stored here. Mirrors the shape of TaskReference.
 *
 * Soft-delete via `unlinkedAt` — the partial unique index allows the same (thread, entity)
 * pair to be re-linked after an unlink (resurrection).
 */
export const ThreadEntityLink = pgTable(
  'ThreadEntityLink',
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),

    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    threadId: text()
      .notNull()
      .references((): AnyPgColumn => Thread.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    entityInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    entityDefinitionId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),

    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Soft-delete timestamp. Null = currently linked. */
    unlinkedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('ThreadEntityLink_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    index('ThreadEntityLink_threadId_idx').using('btree', table.threadId.asc().nullsLast()),
    index('ThreadEntityLink_entityInstanceId_idx').using(
      'btree',
      table.entityInstanceId.asc().nullsLast()
    ),
    index('ThreadEntityLink_entityDefinitionId_idx').using(
      'btree',
      table.entityDefinitionId.asc().nullsLast()
    ),
    index('ThreadEntityLink_unlinkedAt_idx').using('btree', table.unlinkedAt.asc().nullsLast()),
    // Partial unique: a thread can be linked to a given entity only once *while active*.
    // After unlink (unlinkedAt IS NOT NULL) the same pair can be re-created.
    uniqueIndex('ThreadEntityLink_threadId_entityInstanceId_active_key')
      .using('btree', table.threadId.asc().nullsLast(), table.entityInstanceId.asc().nullsLast())
      .where(sql`"unlinkedAt" IS NULL`),
  ]
)

export type ThreadEntityLinkEntity = typeof ThreadEntityLink.$inferSelect
export type ThreadEntityLinkInsert = typeof ThreadEntityLink.$inferInsert
