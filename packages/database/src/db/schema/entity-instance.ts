// packages/database/src/db/schema/entity-instance.ts
// Drizzle table for EntityInstance

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, sql, text, timestamp } from './_shared'
import { EntityDefinition } from './entity-definition'
import { Organization } from './organization'
import { User } from './user'

/**
 * EntityInstance table for storing actual records of custom entities
 * Example: An instance of a "Product" entity definition
 *
 * The actual field values are stored in the FieldValue table,
 * linked via fieldValue.entityId = entityInstance.id
 */
export const EntityInstance = pgTable(
  'EntityInstance',
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    /**
     * "Record CONTENT changed" — stamped EXPLICITLY by the write paths (D-7,
     * plans/events/03-write-context-and-batch-lane-plan.md §1). Deliberately
     * NO `$onUpdate`: the old auto-bump moved on every physical row write,
     * so bookkeeping writes (`lastActivityAt`, interaction stamps, scan
     * watermarks, connector ownership stamps, metadata counters) re-dirtied
     * records into dedup rescan loops. Now: `defaultNow()` stamps creates;
     * archive/restore stamps in `update-entity-instance.ts`; a field-value
     * write that performs at least one REAL change stamps once via
     * `setValuesForEntity` (idempotent no-ops don't); bookkeeping writes
     * simply don't stamp.
     */
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    archivedAt: timestamp({ precision: 3, withTimezone: true }),

    /** Reference to the entity definition this is an instance of */
    entityDefinitionId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Organization this instance belongs to */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** User who created this instance (for audit) */
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Denormalized primary display field value for fast sorting/display */
    displayName: text(),

    /** Denormalized secondary display field value (subtitle/description) */
    secondaryDisplayValue: text(),

    /**
     * Denormalized visual identity ref from `avatarFieldId`.
     * Polymorphic encoding (see `parseVisualRef` / `encodeAvatarRef`):
     *   - `https://…` or `url:…` → image URL
     *   - `base64:…` → base64 image
     *   - emoji literal → emoji
     *   - `color:<name>` → colored swatch (e.g. `color:indigo`)
     *   - `icon:<lucideId>[:<color>]` → lucide icon + optional color
     *   - bare lucide id → entity icon fallback
     * Most rows still hold a real URL; the encoded forms are used for
     * entities whose `avatarFieldId` points at a non-URL source (e.g.
     * `inbox.color`).
     */
    avatarUrl: text(),

    /** Combined searchable text from key fields (for full-text search) */
    searchText: text(),

    /**
     * Generic metadata JSONB for system-managed fields.
     * Structure varies by entityType - typing enforced at service layer.
     * @see packages/lib/src/entity-instances/metadata-types.ts
     */
    metadata: jsonb(),

    /**
     * Last meaningful activity on this entity (message in/out, comment, field
     * change, etc.). Advanced monotonically by `touchEntityActivity()`.
     * Drives staleness scanners (Today, etc.).
     */
    lastActivityAt: timestamp({ precision: 3 }),

    /**
     * Set by the AI suggestion scanner (Phase 3c) every time it runs the
     * headless kopilot on this entity — regardless of whether actions were
     * proposed. Combined with `lastActivityAt`, drives the candidate-query
     * suppression predicate ("never scanned, or scanned before latest
     * activity"). Replaces v2's NOOP-row mechanism.
     */
    lastSuggestionScanAt: timestamp({ precision: 3 }),

    /**
     * Set by the duplicate scanner every time it blocks + scores this record.
     * The dirty predicate is deliberately NOT `lastActivityAt` (which the
     * suggestion scanner uses): the scan compares this against
     * `GREATEST(ei."updatedAt", max(fv."updatedAt"))`. Since D-7, `updatedAt`
     * is stamped explicitly on content changes (including handler-mediated
     * field writes), but raw writers that bypass the handler still only move
     * `FieldValue.updatedAt` — the `GREATEST` arm stays load-bearing for those.
     */
    lastDuplicateScanAt: timestamp({ precision: 3 }),

    /**
     * Oldest real correspondence with this entity (message `sentAt`, not
     * processing time). Written first-wins by `touchEntityInteraction()` —
     * ingest-derived, so backfilled mailboxes converge to historical values.
     * Narrower than `lastActivityAt`: comments and field edits don't count.
     */
    firstInteractionAt: timestamp({ precision: 3 }),

    /**
     * Message that produced `firstInteractionAt`. Deliberately no FK — messages
     * hard-delete on channel disconnect and a dangling ref degrades to
     * "unknown who" at read time; the timestamp stands.
     */
    firstInteractionMessageId: text(),

    /**
     * Newest real correspondence with this entity (message `sentAt`). Written
     * last-wins by `touchEntityInteraction()`. See `firstInteractionAt`.
     */
    lastInteractionAt: timestamp({ precision: 3 }),

    /** Message that produced `lastInteractionAt`. No FK — see `firstInteractionMessageId`. */
    lastInteractionMessageId: text(),
  },
  (table) => [
    // Index for entity definition lookups
    index('EntityInstance_entityDefinitionId_idx').using(
      'btree',
      table.entityDefinitionId.asc().nullsLast()
    ),
    // Index for organization lookups
    index('EntityInstance_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    // Index for archived instances
    index('EntityInstance_archivedAt_idx').using('btree', table.archivedAt.asc().nullsLast()),
    // Composite index for common queries
    index('EntityInstance_orgId_defId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast()
    ),
    // Index for display name sorting
    index('EntityInstance_displayName_idx').using('btree', table.displayName.asc().nullsLast()),
    // Staleness scanner index: org + entity type + activity recency.
    index('EntityInstance_organizationId_entityDefinitionId_lastActivityAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast(),
      table.lastActivityAt.asc().nullsLast()
    ),
    // Interaction recency sorting/filtering, mirroring the activity index.
    index('EntityInstance_organizationId_entityDefinitionId_lastInteractionAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast(),
      table.lastInteractionAt.asc().nullsLast()
    ),
    // AI suggestion scanner candidate query (Phase 3c): non-archived rows
    // ordered by activity & last-scan, scoped per (org, entity definition).
    index('EntityInstance_org_def_scan_idx')
      .on(
        table.organizationId,
        table.entityDefinitionId,
        table.lastActivityAt,
        table.lastSuggestionScanAt
      )
      .where(sql`"archivedAt" IS NULL`),
    // Duplicate scanner candidate query: the same shape as the AI-suggestion
    // index above, but keyed on `updatedAt` rather than `lastActivityAt` —
    // `skipEvents` writers never touch `lastActivityAt`, so the dirty predicate
    // for dedup is `GREATEST(ei."updatedAt", max(fv."updatedAt")) >
    // "lastDuplicateScanAt"`. EVERY scan door runs this query (the mutation
    // seam, the sync-manifest consumer, and the 6h sweep all share one
    // watermark-driven handler), not just the sweep. Since D-7 removed
    // `$onUpdate`, bookkeeping writes (watermark stamps, `lastSuggestionScanAt`,
    // activity/interaction touches) no longer bump `updatedAt`, so they can no
    // longer re-dirty a record against its own fresh watermark.
    index('EntityInstance_org_def_dup_scan_idx')
      .on(
        table.organizationId,
        table.entityDefinitionId,
        table.updatedAt,
        table.lastDuplicateScanAt
      )
      .where(sql`"archivedAt" IS NULL`),
    // Default list order: newest first, per (org, entity definition).
    //
    // `queryEntityInstanceIdsPaged` orders an unsorted list by
    // `createdAt DESC, id ASC` — the fallback every records view, drawer tab and
    // related-record card uses until someone picks a column to sort by. Column
    // order and direction match that ORDER BY exactly (mixed directions cannot
    // be served by a backward scan of an ASC index), and the partial predicate
    // matches the query's `archivedAt IS NULL`, so the common list page is a
    // pure index scan with no sort node.
    index('EntityInstance_org_def_createdAt_idx')
      .on(table.organizationId, table.entityDefinitionId, table.createdAt.desc(), table.id.asc())
      .where(sql`"archivedAt" IS NULL`),
    // Free-text search, third arm: `secondaryDisplayValue ILIKE '%q%'`.
    //
    // `gin_trgm_ops` serves `~~*` (ILIKE) as well as `%`, so this makes the
    // fallback arm of `textSearchPredicate` (packages/lib/src/search/
    // text-search-sql.ts) index-servable. That matters far more than the arm
    // itself: the predicate is an OR block, and Postgres builds it as a
    // `BitmapOr` of one index scan per arm — a single arm with no index
    // condition forces it to abandon the *other* indexes too and filter the
    // whole org+def slice row by row. Measured on a 400k-row copy with a 100k
    // slice: 125 ms without this index, 32 ms with it, identical result set.
    //
    // Org-scoped composite to match the two GIN indexes from migration 0058
    // (which is also where `pg_trgm` and `btree_gin` are installed — `btree_gin`
    // is what lets `organizationId` lead a GIN index).
    index('EntityInstance_org_secondaryDisplayValue_trgm_idx').using(
      'gin',
      table.organizationId,
      table.secondaryDisplayValue.op('gin_trgm_ops')
    ),
    // Note: the org-scoped GIN indexes for the other two search arms
    // (`EntityInstance_org_searchText_gin_idx` on
    // `to_tsvector('english', COALESCE("searchText", ''))` and
    // `EntityInstance_org_displayName_trgm_idx`) live in migration 0058 and are
    // deliberately NOT declared here — Drizzle's snapshot never held them, so
    // re-declaring them now would generate a duplicate CREATE INDEX.
    // Note: Partial indexes on metadata fields should be added via raw SQL:
    // CREATE UNIQUE INDEX "EntityInstance_mailgunMessageId_key" ON "EntityInstance" (("metadata"->>'mailgunMessageId')) WHERE "metadata"->>'mailgunMessageId' IS NOT NULL;
    // CREATE INDEX "EntityInstance_internalReference_idx" ON "EntityInstance" (("metadata"->>'internalReference')) WHERE "metadata"->>'internalReference' IS NOT NULL;
  ]
)

/** Type for selecting from EntityInstance table */
export type EntityInstanceEntity = typeof EntityInstance.$inferSelect

/** Type for inserting into EntityInstance table */
export type EntityInstanceInsert = typeof EntityInstance.$inferInsert
