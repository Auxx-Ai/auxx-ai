// packages/database/src/db/schema/ai-suggestion.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityDefinition } from './entity-definition'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { Thread } from './thread'
import { User } from './user'

/**
 * AiSuggestion — a bundle of `ProposedAction[]` produced by the headless
 * kopilot runner (Phase 3b) for one entity. The Today UI (Phase 3e) lists
 * FRESH bundles for the user to triage; apply-time walks the actions in
 * topological order, substituting `temp_<n>` references with real IDs.
 *
 * Status state machine:
 *   FRESH ──approve(all)──→ APPROVED
 *   FRESH ──approve(some)─→ PARTIALLY_APPROVED
 *   FRESH ──reject────────→ REJECTED
 *   FRESH ──activity++────→ STALE
 *
 * NOOP runs (model proposed nothing) do NOT insert a row — suppression lives
 * on `EntityInstance.lastSuggestionScanAt` instead. This shrinks the table,
 * removes the NOOP TTL question, and naturally re-evaluates when activity
 * advances.
 *
 * The bundle JSON column stores `{ actions: ProposedAction[], summary,
 * modelId, headlessTraceId, computedForLatestMessageId? }` — see
 * `packages/lib/src/approvals/types.ts` for the canonical shape.
 */
export const AiSuggestion = pgTable(
  'AiSuggestion',
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
     * v3: required. Bare-thread bundles dropped from v1 (manual-only, no
     * proven demand). A separate BareThreadSuggestion table can land later
     * if thread-conversion becomes a real surface.
     */
    entityInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /**
     * Denormalized so the bundle card renders without joining EntityInstance
     * just to know the entity type. Always populated alongside entityInstanceId.
     */
    entityDefinitionId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /**
     * Optional pointer to the thread that motivated the bundle (e.g. an
     * inbound message on a thread linked to this entity). Used for card
     * context, not for routing.
     */
    threadId: text().references((): AnyPgColumn => Thread.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /**
     * Snapshot of entity owner at bundle creation. Reassignments do NOT
     * re-route old bundles — the bundle is stale by the time owner moves.
     */
    ownerUserId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** `{ actions: ProposedAction[], summary, modelId, headlessTraceId, ... }` */
    bundle: jsonb().notNull(),

    /** Cardinality of `bundle.actions` — denormalized for cheap counts. */
    actionCount: integer().notNull(),

    /** entity.lastActivityAt at compute time; drives the FRESH→STALE flip. */
    computedForActivityAt: timestamp({ precision: 3 }).notNull(),
    /** Latest message id at compute time — Phase 3d's debounce reads this. */
    computedForLatestMessageId: text(),

    /** 'event' | 'stale_scan' | 'manual' | 'override' */
    triggerSource: text().notNull(),
    triggerEventType: text(),

    /** 'FRESH' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' | 'STALE' */
    status: text().notNull().default('FRESH'),

    /** `ActionOutcome[]` populated when the bundle is applied (Phase 3e). */
    outcomes: jsonb(),

    decidedById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    decidedAt: timestamp({ precision: 3 }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Single partial unique index — only one active (FRESH) bundle per entity.
    // The scanner relies on this to no-op when a bundle is already in flight.
    uniqueIndex('AiSuggestion_org_entity_active_key')
      .on(table.organizationId, table.entityInstanceId)
      .where(sql`status = 'FRESH'`),
    // Today-tab list query: filter by org + status, page-by-page.
    index('AiSuggestion_org_status_idx').on(table.organizationId, table.status),
    // Per-entity history (audit log on a record's card).
    index('AiSuggestion_org_entity_createdAt_idx').on(
      table.organizationId,
      table.entityInstanceId,
      table.createdAt
    ),
    // Per-entity-type filtering on Today (e.g. "show me only Deal bundles").
    index('AiSuggestion_org_entityDef_status_idx').on(
      table.organizationId,
      table.entityDefinitionId,
      table.status
    ),
  ]
)

export type AiSuggestionEntity = typeof AiSuggestion.$inferSelect
export type AiSuggestionInsert = typeof AiSuggestion.$inferInsert
