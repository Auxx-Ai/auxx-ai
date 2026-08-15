// packages/database/src/db/schema/duplicate-suggestion.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityDefinition } from './entity-definition'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

/**
 * DuplicateSuggestion — one scored, canonically-ordered PAIR of records the
 * dedup engine believes are the same entity. Suggestion-only: nothing here ever
 * merges automatically.
 *
 * The pair is the unit, not the cluster. Clustering (union-find over the open
 * pairs of a def) happens at read time, so a pair can be dismissed or merged
 * without invalidating its neighbours.
 *
 * **Canonical ordering is a storage invariant**: `instanceIdLow` <
 * `instanceIdHigh` by string comparison, enforced by the writer
 * (`dedup/pairs.ts`), so `(A,B)` and `(B,A)` collapse onto the same row via the
 * unique index below. Without it the engine would write both directions and the
 * queue would show every duplicate twice.
 *
 * Status state machine:
 *   open ──dismiss──→ dismissed ──rescore at a HIGHER band──→ open
 *   open ──merge────→ merged (terminal — never reopened, never rescored)
 *
 * `dismissedBand` is what makes the reopen arm safe: a pair dismissed at
 * `medium` that later earns `high` (e.g. the records turn out to share an email)
 * reopens, while a re-scored medium pair stays dismissed. Sticky dismissal
 * without the band snapshot would either bury a strengthened pair forever or
 * nag on every rescore.
 *
 * Snoozed is NOT a status — it is `open` plus a future `snoozeUntil`, so the
 * pair returns to the queue on its own with no sweep to un-snooze it.
 *
 * FK cascade is on HARD delete only. Merge ARCHIVES the source record (soft), so
 * the rows survive the merge and `resolveSuggestionsForMerge` has to close them
 * explicitly inside the merge transaction.
 */
export const DuplicateSuggestion = pgTable(
  'DuplicateSuggestion',
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

    /**
     * Both sides always share a definition — the engine never pairs across defs.
     * Denormalized so the queue can filter by entity type without joining
     * either instance.
     */
    entityDefinitionId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Lexicographically SMALLER of the two instance ids. See the canonical-ordering note. */
    instanceIdLow: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Lexicographically LARGER of the two instance ids. See the canonical-ordering note. */
    instanceIdHigh: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /**
     * Confidence in [0, 1], the clamped weighted sum of `signals`
     * (`dedup/config.ts` owns the weights). Sorts the review queue — never a
     * raw trigram similarity, which ranks siblings above real nickname pairs.
     */
    score: doublePrecision().notNull(),

    /** `'high'` (strong exact key) | `'medium'` (fuzzy + corroboration, or the name-alone rule). */
    band: text().notNull(),

    /**
     * `Signal[]` — the evidence, each entry carrying the MATCHED VALUE, not just
     * the field. Multi-value identity fields (contact `primary_email`, contact
     * `phone`, company `website`) make "matched on: email" ambiguous otherwise.
     * @see packages/lib/src/dedup/types.ts
     */
    signals: jsonb().notNull(),

    /** `'open'` | `'dismissed'` | `'merged'`. Snoozed = `open` + future `snoozeUntil`. */
    status: text().notNull().default('open'),

    dismissedByUserId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    dismissedAt: timestamp({ precision: 3 }),

    /** Band at dismissal time — a later, HIGHER band reopens the pair. */
    dismissedBand: text(),

    /** While in the future the pair is hidden from the queue but still `open`. */
    snoozeUntil: timestamp({ precision: 3 }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One row per (org, def, canonical pair) — the upsert target. Rescoring is
    // an `onConflictDoUpdate` against this index, which is also what makes a
    // re-scan idempotent no matter how many doors enqueued it.
    uniqueIndex('DuplicateSuggestion_org_def_pair_key').on(
      table.organizationId,
      table.entityDefinitionId,
      table.instanceIdLow,
      table.instanceIdHigh
    ),
    // Review queue: open pairs for an org, best-scoring first (keyset paging).
    index('DuplicateSuggestion_org_status_score_idx').on(
      table.organizationId,
      table.status,
      table.score.desc()
    ),
    // Per-record lookups (the header indicator, and rescore-on-change). Two
    // indexes because the canonical ordering means a record can sit on either
    // side and the reader has to OR both columns.
    index('DuplicateSuggestion_org_low_idx').on(table.organizationId, table.instanceIdLow),
    index('DuplicateSuggestion_org_high_idx').on(table.organizationId, table.instanceIdHigh),
  ]
)

export type DuplicateSuggestionEntity = typeof DuplicateSuggestion.$inferSelect
export type DuplicateSuggestionInsert = typeof DuplicateSuggestion.$inferInsert
