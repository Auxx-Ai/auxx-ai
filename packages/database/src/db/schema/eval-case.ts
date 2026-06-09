// packages/database/src/db/schema/eval-case.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, evalKind, index, jsonb, pgTable, text, timestamp } from './_shared'
import { Agent } from './agent'
import { Organization } from './organization'
import { Procedure } from './procedure'
import { User } from './user'

/**
 * A reusable eval definition: a version-pinned target, synthetic inputs, mocks,
 * and assertions. Phase 1 only persists `agent_simulation` cases. Each run
 * snapshots the case immutably, so the mutable case is free to evolve.
 *
 * `target`, `config`, and `assertions` stay GENERIC jsonb because
 * `@auxx/database` can't see lib/types' `AgentEvalTarget` / `SimulationConfig` /
 * `AgentEvalAssertion[]` shapes (`@auxx/types` depends on `@auxx/database`, not
 * the reverse). The service layer in `@auxx/lib/evals` parses/casts them at the
 * boundary via the `@auxx/types/evals` Zod schemas.
 *
 * `agentId` / `procedureId` are DENORMALIZED from `target` so the hot list path
 * (`listEvalCasesByAgent`, optionally scoped to one procedure) is a plain
 * indexed equality instead of a jsonb scan. `target` remains the source of
 * truth; the service keeps these in sync on write.
 *
 * See plans/evals/phase-1-agent-simulation.md §1.2.
 */
export const EvalCase = pgTable(
  'EvalCase',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    kind: evalKind().notNull(),
    target: jsonb().$type<Record<string, unknown>>().notNull(),
    name: text().notNull(),
    config: jsonb().$type<Record<string, unknown>>().notNull(),
    assertions: jsonb().$type<unknown[]>().default([]).notNull(),

    /** Denormalized from `target` for indexed listing. Nullable for non-agent kinds. */
    agentId: text().references((): AnyPgColumn => Agent.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    /** Denormalized from `target` (`scope: 'procedure'` only). */
    procedureId: text().references((): AnyPgColumn => Procedure.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    /** Phase 3 provenance: the suggestion this case was created from. */
    suggestionId: text(),

    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('EvalCase_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('EvalCase_kind_idx').using('btree', table.kind.asc().nullsLast()),
    index('EvalCase_agentId_procedureId_idx').using(
      'btree',
      table.agentId.asc().nullsLast(),
      table.procedureId.asc().nullsLast()
    ),
  ]
)

export type EvalCaseEntity = typeof EvalCase.$inferSelect
export type EvalCaseInsert = typeof EvalCase.$inferInsert
export type EvalCaseUpdate = Partial<EvalCaseInsert>
