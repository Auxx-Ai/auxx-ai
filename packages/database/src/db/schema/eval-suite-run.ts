// packages/database/src/db/schema/eval-suite-run.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  evalKind,
  evalSuiteRunStatus,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * Parent of a `runAll` / recorded-ticket batch. Its `status` describes
 * ORCHESTRATION, not assertion roll-up: it becomes `completed` once every child
 * {@link EvalRun} is terminal regardless of how many passed/failed, and is only
 * `error` when suite orchestration itself can't complete. Pass/fail/error rates
 * come from the counters.
 *
 * `selectionSnapshot` records the exact ordered case ids (or recorded-ticket ids
 * + sampling seed) chosen at creation, so the batch is reproducible.
 *
 * See plans/evals/phase-1-agent-simulation.md §1.2.
 */
export const EvalSuiteRun = pgTable(
  'EvalSuiteRun',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    kind: evalKind().notNull(),
    status: evalSuiteRunStatus().notNull(),

    /** Denormalized batch run mode — `'draft'` when any child ran a compiled draft. */
    runMode: text().$type<'pinned' | 'draft'>().notNull().default('pinned'),
    /** Compiler `contentHash` of the draft a draft suite tested (iteration history). */
    draftContentHash: text(),
    /** Comparison anchor for the suite verdict diff — navigation only. */
    baselineSuiteRunId: text().references((): AnyPgColumn => EvalSuiteRun.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /**
     * Denormalized from the `runAll` selection so suites list per agent/procedure
     * (`selectionSnapshot` holds only case ids). No FK — suite history outlives
     * deleted agents/procedures, like `EvalRun.caseId`'s retention policy.
     */
    agentId: text(),
    procedureId: text(),

    requestedCount: integer().notNull().default(0),
    completedCount: integer().notNull().default(0),
    passedCount: integer().notNull().default(0),
    failedCount: integer().notNull().default(0),
    errorCount: integer().notNull().default(0),
    cancelledCount: integer().notNull().default(0),
    timedOutCount: integer().notNull().default(0),

    /** Ordered case ids selected for this batch (+ sampling metadata for recorded tickets). */
    selectionSnapshot: jsonb().$type<Record<string, unknown>>().notNull(),

    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    startedAt: timestamp({ precision: 3 }),
    completedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('EvalSuiteRun_organizationId_createdAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.createdAt.desc().nullsLast()
    ),
    index('EvalSuiteRun_status_idx').using('btree', table.status.asc().nullsLast()),
    // Per-agent/procedure suite listing (iteration history, diff navigation).
    index('EvalSuiteRun_agentId_createdAt_idx').using(
      'btree',
      table.agentId.asc().nullsLast(),
      table.createdAt.desc().nullsLast()
    ),
  ]
)

export type EvalSuiteRunEntity = typeof EvalSuiteRun.$inferSelect
export type EvalSuiteRunInsert = typeof EvalSuiteRun.$inferInsert
export type EvalSuiteRunUpdate = Partial<EvalSuiteRunInsert>
