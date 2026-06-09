// packages/database/src/db/schema/eval-run.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  evalKind,
  evalRunStatus,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from './_shared'
import { EvalCase } from './eval-case'
import { EvalSuiteRun } from './eval-suite-run'
import { Organization } from './organization'

/**
 * One immutable execution of an {@link EvalCase}. Both snapshots are required at
 * `queued` insert time and never change, so historical run detail renders purely
 * from `definitionSnapshot` / `runtimeSnapshot` — never by joining the mutable
 * case. `snapshotHash` is the canonical hash of both.
 *
 * `caseId` is nullable with `onDelete: 'set null'`: deleting a case keeps its
 * runs (history-retention policy) but detaches them.
 *
 * `status` semantics: `failed` = assertions ran and ≥1 failed; `error` =
 * execution/grading couldn't complete; `timed_out` = watchdog expiry. The run
 * row owns lifecycle state — BullMQ retention is not run history.
 *
 * snapshots/trace/assertionResults stay GENERIC jsonb; `@auxx/lib/evals` casts
 * them via `@auxx/types/evals` schemas. See plans/evals/phase-1-agent-simulation.md §1.2.
 */
export const EvalRun = pgTable(
  'EvalRun',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    caseId: text().references((): AnyPgColumn => EvalCase.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    suiteRunId: text().references((): AnyPgColumn => EvalSuiteRun.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    kind: evalKind().notNull(),
    status: evalRunStatus().notNull(),

    definitionSnapshot: jsonb().$type<Record<string, unknown>>().notNull(),
    runtimeSnapshot: jsonb().$type<Record<string, unknown>>().notNull(),
    snapshotHash: text().notNull(),

    traceVersion: integer().notNull().default(1),
    trace: jsonb().$type<unknown[]>().default([]).notNull(),
    lastTraceSequence: integer().notNull().default(0),
    assertionResults: jsonb().$type<unknown[]>().default([]).notNull(),

    attempt: integer().notNull().default(0),

    startedAt: timestamp({ precision: 3 }),
    heartbeatAt: timestamp({ precision: 3 }),
    completedAt: timestamp({ precision: 3 }),

    errorCode: text(),
    error: text(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('EvalRun_caseId_createdAt_idx').using(
      'btree',
      table.caseId.asc().nullsLast(),
      table.createdAt.desc().nullsLast()
    ),
    index('EvalRun_suiteRunId_idx').using('btree', table.suiteRunId.asc().nullsLast()),
    index('EvalRun_organizationId_createdAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.createdAt.desc().nullsLast()
    ),
    // Watchdog scan for stale queued/running runs by heartbeat.
    index('EvalRun_status_heartbeatAt_idx').using(
      'btree',
      table.status.asc().nullsLast(),
      table.heartbeatAt.asc().nullsLast()
    ),
  ]
)

export type EvalRunEntity = typeof EvalRun.$inferSelect
export type EvalRunInsert = typeof EvalRun.$inferInsert
export type EvalRunUpdate = Partial<EvalRunInsert>
