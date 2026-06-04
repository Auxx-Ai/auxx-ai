// packages/database/src/db/schema/agent-procedure.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Agent } from './agent'
import { Organization } from './organization'
import { Procedure } from './procedure'

/**
 * M:N link between an {@link Agent} and a {@link Procedure}, carrying per-agent
 * overrides. A `null` override inherits the Procedure default (resolved
 * `override ?? default` at selection time).
 *
 * Override columns stay GENERIC jsonb (same reason as Procedure's defaults);
 * the service layer casts `triggerExamplesOverride` → `TriggerExample[]` and
 * `rulesetOverride` → `ConditionGroup[]`.
 *
 * See plans/chat/v9/phase-0-schema-types-compiler.md §1c.
 */
export const AgentProcedure = pgTable(
  'AgentProcedure',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    agentId: text()
      .notNull()
      .references((): AnyPgColumn => Agent.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    procedureId: text()
      .notNull()
      .references((): AnyPgColumn => Procedure.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    enabled: boolean().notNull().default(true),
    priority: integer().notNull().default(0),

    // per-agent overrides — null = inherit the Procedure default
    whenToUseOverride: text(),
    triggerExamplesOverride: jsonb().$type<unknown[]>(),
    rulesetOverride: jsonb().$type<unknown[]>(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('AgentProcedure_agentId_idx').using('btree', table.agentId.asc().nullsLast()),
    uniqueIndex('AgentProcedure_agentId_procedureId_key').using(
      'btree',
      table.agentId.asc(),
      table.procedureId.asc()
    ),
  ]
)

export type AgentProcedureEntity = typeof AgentProcedure.$inferSelect
export type AgentProcedureInsert = typeof AgentProcedure.$inferInsert
