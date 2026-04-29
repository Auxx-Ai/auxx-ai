// packages/database/src/db/schema/suggestion-dismissal.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

/**
 * SuggestionDismissal — per-user, per-entity skip record. The stale scanner's
 * candidate query filters out entities the user dismissed at or above their
 * current `lastActivityAt`. Dismissal is per-user — User A skipping a bundle
 * does NOT hide it from User B (org-level dismissal is an open question for
 * v2 based on beta feedback; see Phase 3c open Q1).
 *
 * `dismissedAtActivity` is set to the entity's `lastActivityAt` at dismissal
 * time. The candidate query's `dismissedAtActivity >= ei.lastActivityAt`
 * predicate naturally re-surfaces the entity when activity advances.
 *
 * `snoozeUntil` is an optional time-based unmute. When `NOW() > snoozeUntil`,
 * the dismissal stops suppressing — but the activity-based predicate still
 * applies, so a stale entity with no new activity stays hidden until activity
 * advances (correct behavior; see Phase 3c open Q11).
 */
export const SuggestionDismissal = pgTable(
  'SuggestionDismissal',
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

    userId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /**
     * v3: required. Bare-thread bundles dropped — dismissal target is always
     * an entity.
     */
    entityInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** entity.lastActivityAt at dismissal time. */
    dismissedAtActivity: timestamp({ precision: 3 }).notNull(),

    /** Optional time-based unmute. NULL = dismissal lasts until activity advances. */
    snoozeUntil: timestamp({ precision: 3 }),

    /** Optional free-text reason for analytics — not exposed in product copy. */
    reason: text(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One dismissal row per (org, user, entity); upsert on subsequent dismissals.
    uniqueIndex('SuggestionDismissal_org_user_entity_key').on(
      table.organizationId,
      table.userId,
      table.entityInstanceId
    ),
    index('SuggestionDismissal_org_user_idx').on(table.organizationId, table.userId),
  ]
)

export type SuggestionDismissalEntity = typeof SuggestionDismissal.$inferSelect
export type SuggestionDismissalInsert = typeof SuggestionDismissal.$inferInsert
