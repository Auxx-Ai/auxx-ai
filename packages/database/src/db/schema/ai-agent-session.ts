// packages/database/src/db/schema/ai-agent-session.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp } from './_shared'
import { Organization } from './organization'
import { User } from './user'

export const AiAgentSession = pgTable(
  'AiAgentSession',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    /** Domain type discriminator: 'kopilot' | 'builder' */
    type: text().notNull(),
    /** Optional human-readable title (LLM-generated after first exchange) */
    title: text(),
    /** Model identifier in "provider:model" format — null means system default was used */
    modelId: text(),
    /** Full conversation history as JSONB array of SessionMessage */
    messages: jsonb().$type<Record<string, unknown>[]>().default([]).notNull(),
    /** Domain-specific state (plan, page context, etc.) */
    domainState: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    userId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
  },
  (table) => [
    index('AiAgentSession_organizationId_userId_type_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.userId.asc().nullsLast(),
      table.type.asc().nullsLast()
    ),
    index('AiAgentSession_userId_type_updatedAt_idx').using(
      'btree',
      table.userId.asc().nullsLast(),
      table.type.asc().nullsLast(),
      table.updatedAt.desc().nullsLast()
    ),
  ]
)

export type AiAgentSessionEntity = typeof AiAgentSession.$inferSelect
export type AiAgentSessionInsert = typeof AiAgentSession.$inferInsert
