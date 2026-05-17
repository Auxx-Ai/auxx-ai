// packages/database/src/db/schema/agent.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * One entry inside `Agent.toolsets`. Replaces the old `AgentToolset` join
 * table. See plans/kopilot/agents/ui/single-row-agent.md §1.
 */
export interface ToolsetEntry {
  slug: string
  /** Optional AppInstallation id for app toolsets. Null/absent for native toolsets. */
  appInstallationId?: string | null
  /** Toolset-shaped overrides — `{ disabledTools?: string[] }`. */
  config: Record<string, unknown>
  enabled: boolean
  source: 'manual' | 'mention' | 'auto_default'
}

/**
 * One entry inside `Agent.knowledge`. Replaces the old `AgentResourceScope`
 * table.
 *
 * `recordId` is `${entityDefinitionId}:${entityInstanceId}` for instance-level
 * rules, or just `${entityDefinitionId}` (no colon) for definition-level rules
 * ("every record under this definition"). See plans/kopilot/agents/ui/single-row-agent.md §1.
 */
export interface KnowledgeEntry {
  recordId: string
  mode: 'include_descendants' | 'include_one' | 'exclude'
  source: 'manual' | 'mention'
}

/**
 * A user-authored Kopilot agent. Backed by a synthetic User row
 * (userType = 'AGENT'). Optional configuration layer on top of the
 * master Kopilot runtime.
 */
export const Agent = pgTable(
  'Agent',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** The synthetic User row backing this agent. 1:1. */
    userId: text()
      .notNull()
      .unique()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** The human who created the agent. */
    createdById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'restrict',
      }),

    slug: text().notNull(),
    description: text(),

    prompt: jsonb().$type<Record<string, unknown>>().default({}).notNull(),

    /**
     * Per-agent toolset configuration. One entry per slug enabled on the
     * agent. Replaces the old `AgentToolset` join table. See
     * plans/kopilot/agents/ui/single-row-agent.md.
     */
    toolsets: jsonb().$type<ToolsetEntry[]>().default(sql`'[]'::jsonb`).notNull(),

    /**
     * Per-agent knowledge access rules. One entry per `recordId`. Replaces
     * the old `AgentResourceScope` table. See
     * plans/kopilot/agents/ui/single-row-agent.md.
     */
    knowledge: jsonb().$type<KnowledgeEntry[]>().default(sql`'[]'::jsonb`).notNull(),

    mentionable: boolean().default(true).notNull(),

    modelId: text(),

    /**
     * `null` while the agent is mid-build via the chat-driven setup flow;
     * timestamp when the builder fires `complete_agent_setup` (or the admin
     * clicks the rail escape hatch). The rail UI swaps the setup carousel for
     * the Prompt/Tools/Knowledge tabs when this flips.
     */
    setupCompletedAt: timestamp({ precision: 3 }),

    archivedAt: timestamp({ precision: 3 }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('Agent_organizationId_slug_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.slug.asc().nullsLast()
    ),
    index('Agent_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('Agent_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
    index('Agent_organizationId_archivedAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.archivedAt.asc().nullsLast()
    ),
    index('Agent_userId_idx').using('btree', table.userId.asc().nullsLast()),
  ]
)

export type AgentEntity = typeof Agent.$inferSelect
export type AgentInsert = typeof Agent.$inferInsert
