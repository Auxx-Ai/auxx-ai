// packages/database/src/db/schema/agent-toolset.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  agentToolsetSource,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Agent } from './agent'

/**
 * Per-agent enabled toolset. One row per toolset slug enabled on the
 * agent. Unknown slugs are tolerated at runtime (filtered at register time).
 */
export const AgentToolset = pgTable(
  'AgentToolset',
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

    toolsetSlug: text().notNull(),

    /** Optional AppInstallation id for app toolsets. NULL for native toolsets. */
    appInstallationId: text(),

    config: jsonb().$type<Record<string, unknown>>().default({}).notNull(),

    /**
     * Where this row came from. 'manual' = admin enabled it in the UI.
     * 'mention' = reconciled from a tool mention in the agent's prompt.
     * 'auto_default' = inserted at agent-create because the toolset's
     * `isDefault` flag was true.
     * See plans/kopilot/agents/prompt-mentions.md §6.
     */
    source: agentToolsetSource().default('manual').notNull(),

    enabled: boolean().default(true).notNull(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('AgentToolset_agentId_slug_idx').using(
      'btree',
      table.agentId.asc().nullsLast(),
      table.toolsetSlug.asc().nullsLast()
    ),
    index('AgentToolset_agentId_enabled_idx').using(
      'btree',
      table.agentId.asc().nullsLast(),
      table.enabled.asc().nullsLast()
    ),
  ]
)

export type AgentToolsetEntity = typeof AgentToolset.$inferSelect
export type AgentToolsetInsert = typeof AgentToolset.$inferInsert
