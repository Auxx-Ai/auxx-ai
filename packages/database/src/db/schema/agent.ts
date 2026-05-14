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
 * A record pinned to an agent. Surfaced in the system prompt as an
 * id-pointer (title + type label + optional note) — bodies are never
 * injected. The agent fetches content on demand via load_records /
 * per-type get_* tools. See plans/kopilot/agents/knowledge-access.md §2.2 / §4.
 */
export interface PinnedRecord {
  /** `${entityDefinitionId}:${entityInstanceId}` — see @auxx/types RecordId. */
  recordId: string
  pinReason: 'manual' | 'mention'
  /** Manual pins only — one-liner from the admin about when to use this record. */
  note?: string
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
     * Records pinned to this agent — surfaced as id-pointers in the system
     * prompt at session-init. Reconciled atomically with `prompt` on save:
     * `pinReason='mention'` entries are rebuilt from the Tiptap doc walk,
     * `pinReason='manual'` entries are admin-set. Hard cap 50 (Q-K2).
     * See plans/kopilot/agents/knowledge-access.md §3.2.
     */
    pinnedRecords: jsonb().$type<PinnedRecord[]>().default(sql`'[]'::jsonb`).notNull(),

    mentionable: boolean().default(true).notNull(),

    modelId: text(),

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
