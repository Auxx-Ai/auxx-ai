// packages/database/src/db/schema/ai-agent-session.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp } from './_shared'
import { Agent } from './agent'
import { AgentTrigger } from './agent-trigger'
import { Organization } from './organization'
import { User } from './user'
import { WorkflowApp } from './workflow-app'

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
    /** Optional agent ref. Null = master Kopilot session (no per-agent overlay). */
    agentId: text().references((): AnyPgColumn => Agent.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /**
     * Optional workflow ref. Set on sessions created from the workflow
     * builder's Kopilot panel; null on every other session. Scopes that
     * panel's thread lookup and keeps builder threads out of the global
     * session picker (which filters on `IS NULL`).
     *
     * Cascades on delete rather than nulling like `agentId`: `WorkflowApp` has
     * no soft delete, and a builder thread about a workflow that no longer
     * exists has no reader — nulling would also resurrect it into the global
     * picker.
     */
    workflowAppId: text().references((): AnyPgColumn => WorkflowApp.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    /**
     * Set when the session was kicked off by an autonomous trigger. Drives
     * the "Recent runs for this trigger" view in the agent detail UI.
     */
    agentTriggerId: text().references((): AnyPgColumn => AgentTrigger.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /**
     * Kind-specific context captured at fire time. Shapes:
     *   scheduled: { kind: 'scheduled', firedAt, schedulerId }
     *   event:     { kind: 'event', eventType, recordId, firedAt }
     *   app:       { kind: 'app', appId, triggerId, installationId, eventId, firedAt }
     */
    triggerContext: jsonb().$type<Record<string, unknown>>(),
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
    index('AiAgentSession_agentId_updatedAt_idx').using(
      'btree',
      table.agentId.asc().nullsLast(),
      table.updatedAt.desc().nullsLast()
    ),
    index('AiAgentSession_workflowAppId_updatedAt_idx').using(
      'btree',
      table.workflowAppId.asc().nullsLast(),
      table.updatedAt.desc().nullsLast()
    ),
    index('AiAgentSession_agentTriggerId_updatedAt_idx').using(
      'btree',
      table.agentTriggerId.asc().nullsLast(),
      table.updatedAt.desc().nullsLast()
    ),
  ]
)

export type AiAgentSessionEntity = typeof AiAgentSession.$inferSelect
export type AiAgentSessionInsert = typeof AiAgentSession.$inferInsert
