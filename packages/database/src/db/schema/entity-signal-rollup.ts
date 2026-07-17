// packages/database/src/db/schema/entity-signal-rollup.ts
// Per-entity aggregates over `EntitySignal` (plans/signals/01-signal-store.md § Rollups) —
// one row per (org, entityInstanceId), keyed by a signal's `contactEntityInstanceId`. Reads
// (header chips, digest renderer, suppression checks) hit this row instead of scanning
// EntitySignal. Updated inline by `recordSignal()`; `*Count30d` columns are refreshed by a
// nightly decay sweep — the inline path only increments. Keyed on any `EntityInstance` (not
// just contacts) so a later company-rollup job can write the same shape.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, integer, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'

/**
 * One row per (org, entityInstanceId) — the upsert target for `recordSignal()`.
 * Mutable, unlike `EntitySignal` itself.
 */
export const EntitySignalRollup = pgTable(
  'EntitySignalRollup',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** The entity instance this rollup aggregates onto — contacts today, companies later. */
    entityInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    lastOpenedAt: timestamp({ precision: 3 }),
    openCount30d: integer().default(0).notNull(),
    lastClickedAt: timestamp({ precision: 3 }),
    clickCount30d: integer().default(0).notNull(),
    lastVisitAt: timestamp({ precision: 3 }),
    visitCount30d: integer().default(0).notNull(),
    lastRepliedAt: timestamp({ precision: 3 }),
    lastSignalAt: timestamp({ precision: 3 }),
    unsubscribedAt: timestamp({ precision: 3 }),
    bouncedAt: timestamp({ precision: 3 }),
    /** Set alongside `bouncedAt`; only meaningful when it's non-null. */
    bounceType: text().$type<'hard' | 'soft'>(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // The upsert target: one rollup row per entity instance.
    uniqueIndex('EntitySignalRollup_organizationId_entityInstanceId_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityInstanceId.asc().nullsLast()
    ),
  ]
)

export type EntitySignalRollupEntity = typeof EntitySignalRollup.$inferSelect
export type CreateEntitySignalRollupInput = typeof EntitySignalRollup.$inferInsert
export type UpdateEntitySignalRollupInput = Partial<CreateEntitySignalRollupInput>
