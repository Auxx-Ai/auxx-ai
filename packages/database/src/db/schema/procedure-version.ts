// packages/database/src/db/schema/procedure-version.ts

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
import { Organization } from './organization'
import { Procedure } from './procedure'
import { User } from './user'

/**
 * A version of a {@link Procedure} — the draft (edited in place) plus numbered
 * immutable published snapshots. Mirrors KB `ArticleRevision`.
 *
 * `versionNumber = null` is THE draft (one per procedure, doc edited in place);
 * `1..N` are published snapshots, each carrying its `compiled` step tree. A
 * frame pins a `procedureVersionId` and the stepper reads that exact row for
 * the whole run, so published rows are also the run-pin store — a pinned
 * version must not be hard-deleted while any live thread references it.
 *
 * `compiled` is set on PUBLISHED versions only (null on the draft). It stays
 * GENERIC jsonb because `@auxx/database` can't see lib's `CompiledProcedure`;
 * the lib/consumer layer casts it on read.
 *
 * See plans/chat/v9/phase-0-schema-types-compiler.md §1b.
 */
export const ProcedureVersion = pgTable(
  'ProcedureVersion',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    procedureId: text()
      .notNull()
      .references((): AnyPgColumn => Procedure.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    versionNumber: integer(),
    label: text(),

    doc: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    compiled: jsonb().$type<Record<string, unknown>>(),

    /**
     * Selection criteria snapshotted at publish (the versioned model): the live
     * selection path reads these off the ACTIVE version, not the mutable
     * {@link Procedure} row, so a republish/revert moves selection behaviour in
     * lockstep with the executed build. Per-agent overrides still apply live on
     * top (see {@link AgentProcedure}). Generic jsonb for the same reason as
     * `doc`/`compiled` — `@auxx/database` can't see lib's types.
     */
    whenToUse: text().notNull().default(''),
    triggerExamples: jsonb().$type<unknown[]>().default([]).notNull(),
    ruleset: jsonb().$type<unknown[]>().default([]).notNull(),

    editorId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('ProcedureVersion_procedureId_idx').using('btree', table.procedureId.asc().nullsLast()),
    // One row per published number; the draft (null) is excluded by the partial
    // unique (mirror ArticleRevision).
    uniqueIndex('ProcedureVersion_procedureId_versionNumber_key')
      .using('btree', table.procedureId.asc(), table.versionNumber.desc().nullsLast())
      .where(sql`"versionNumber" IS NOT NULL`),
  ]
)

export type ProcedureVersionEntity = typeof ProcedureVersion.$inferSelect
export type ProcedureVersionInsert = typeof ProcedureVersion.$inferInsert
