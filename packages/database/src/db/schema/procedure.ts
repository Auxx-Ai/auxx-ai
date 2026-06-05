// packages/database/src/db/schema/procedure.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, boolean, index, jsonb, pgTable, text, timestamp } from './_shared'
import { Organization } from './organization'

/**
 * A standalone, org-scoped procedure — authored once, reused by many agents
 * (M:N via {@link AgentProcedure}). Mirrors the KB `Article` shape: this row
 * holds the selection DEFAULTS plus two pointers into {@link ProcedureVersion}
 * — a working `draft` (edited in place) and the published `active` version.
 *
 * Publish snapshots the draft into a numbered immutable `ProcedureVersion`
 * (with its compiled step tree) and moves `activeVersionId`; revert just
 * repoints `activeVersionId` at an older version. A running chat pins the
 * `activeVersionId` into its stack frame at selection time and keeps running
 * that exact version for the rest of the run, so a mid-run republish/revert
 * never disturbs an in-flight conversation.
 *
 * See plans/chat/v9/phase-0-schema-types-compiler.md §1a.
 */
export const Procedure = pgTable(
  'Procedure',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    name: text().notNull(),

    /**
     * Selection criteria — the editable DRAFT working copy (per-agent overrides
     * live on {@link AgentProcedure}; null/empty = no gate). Publish snapshots
     * these into {@link ProcedureVersion}; the live selection path reads the
     * ACTIVE version's snapshot, not this row, so editing here marks the
     * procedure dirty (`hasUnpublishedChanges`) until republished. `@auxx/database`
     * depends on neither `@auxx/lib` nor `@auxx/types`, so these stay GENERIC
     * jsonb; the service layer casts `triggerExamples` → `TriggerExample[]` and
     * `ruleset` → `ConditionGroup[]`.
     */
    whenToUse: text().notNull().default(''),
    triggerExamples: jsonb().$type<unknown[]>().default([]).notNull(),
    ruleset: jsonb().$type<unknown[]>().default([]).notNull(),

    /**
     * KB Article-style pointers, both into {@link ProcedureVersion}. Kept
     * nullable with NO DB-level FK (circular chicken-and-egg with
     * `ProcedureVersion.procedureId`); the service layer enforces ordering
     * — insert Procedure, insert empty draft, then set `draftVersionId`.
     */
    draftVersionId: text(),
    activeVersionId: text(),
    hasUnpublishedChanges: boolean().notNull().default(false),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('Procedure_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
  ]
)

export type ProcedureEntity = typeof Procedure.$inferSelect
export type ProcedureInsert = typeof Procedure.$inferInsert
