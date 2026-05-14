// packages/database/src/db/schema/agent-resource-scope.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  agentResourceScopeMode,
  agentResourceScopeSource,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Agent } from './agent'
import { Organization } from './organization'

/**
 * Per-agent resource access scope. One row encodes one of three modes
 * (include_descendants / include_one / exclude) against a polymorphic
 * `(entityDefinitionId, entityInstanceId)` pointer.
 *
 * - `entityDefinitionId` carries either a system ModelType ('article',
 *   'kb', 'ticket', 'dataset', 'meeting', 'entity') or a custom
 *   EntityDefinition cuid.
 * - `entityInstanceId` is NULL for definition-level rows ("every record
 *   under this definition") and a concrete instance id otherwise.
 * - No FK on either column — it's polymorphic across record types.
 *   Stale rows are GC'd via per-resource delete hooks + lazy resolver
 *   tolerance.
 *
 * Master Kopilot has no rows — its resolver short-circuits to "all".
 * See plans/kopilot/agents/knowledge-access.md §3.1.
 */
export const AgentResourceScope = pgTable(
  'AgentResourceScope',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    agentId: text()
      .notNull()
      .references((): AnyPgColumn => Agent.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /**
     * System ModelType string ('article' / 'kb' / 'ticket' / 'dataset' /
     * 'meeting' / 'entity') or a custom EntityDefinition cuid.
     */
    entityDefinitionId: text().notNull(),

    /** NULL = definition-level scope ("every instance under this definition"). */
    entityInstanceId: text(),

    mode: agentResourceScopeMode().notNull(),

    source: agentResourceScopeSource().default('manual').notNull(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('AgentResourceScope_agent_def_instance_idx').using(
      'btree',
      table.agentId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast(),
      table.entityInstanceId.asc().nullsLast()
    ),
    index('AgentResourceScope_agentId_mode_idx').using(
      'btree',
      table.agentId.asc().nullsLast(),
      table.mode.asc().nullsLast()
    ),
    index('AgentResourceScope_org_def_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast()
    ),
    index('AgentResourceScope_org_def_instance_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast(),
      table.entityInstanceId.asc().nullsLast()
    ),
  ]
)

export type AgentResourceScopeEntity = typeof AgentResourceScope.$inferSelect
export type AgentResourceScopeInsert = typeof AgentResourceScope.$inferInsert
