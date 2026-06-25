// packages/database/src/db/schema/agent-trigger.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, boolean, index, jsonb, pgTable, text, timestamp } from './_shared'
import { Agent } from './agent'
import { AppInstallation } from './app-installation'
import { Organization } from './organization'
import { User } from './user'
import { WebhookEndpoint } from './webhook-endpoint'

/**
 * Per-agent autonomous trigger. One row per scheduled/event/app trigger.
 *
 * Hot routing columns (`triggerType`, `entityDefinitionId`, `eventType`,
 * `triggerAppId`, `triggerAppTriggerId`, `triggerInstallationId`,
 * `triggerConnectionId`, `triggerWebhookEndpointId`) mirror the convention used
 * on the `Workflow` table — they are populated per kind and indexed for fast
 * dispatcher lookups. The kind-specific tail lives in JSONB `config`.
 *
 * See plans/kopilot/agents/phase-2-triggers.md §3.1.
 */
export const AgentTrigger = pgTable(
  'AgentTrigger',
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
     * 'scheduled' | 'event' | 'app' | 'webhook-endpoint'. Phase 1.5 adds 'mention' |
     * 'assignment'. For 'webhook-endpoint', the trigger is keyed on
     * `(triggerWebhookEndpointId, triggerTopic)` — an inbound delivery to that
     * endpoint + topic fires the agent (installation-free, like 'event').
     */
    kind: text().notNull(),

    /** On/off switch. Disabled triggers don't fire; scheduler is removed. */
    enabled: boolean().default(true).notNull(),

    /* ---------- Hot routing columns ---------- */

    /**
     * For `kind: 'event'` (CRUD mode): 'created' | 'updated' | 'deleted'.
     * NULL for all other kinds.
     */
    triggerType: text(),

    /**
     * For `kind: 'event'` (CRUD mode): system slug or custom-entity cuid.
     * NULL for all other kinds. Mirrors `Workflow.entityDefinitionId`
     * — string holds either shape.
     */
    entityDefinitionId: text(),

    /**
     * For `kind: 'event'` (direct mode): e.g. 'ticket:assignee:added'.
     * NULL for all other kinds. Mode is implicit: if entityDefinitionId
     * is set → CRUD mode; if eventType is set → direct mode.
     */
    eventType: text(),

    /** For `kind: 'app'`: the app catalog id. NULL otherwise. */
    triggerAppId: text(),

    /**
     * For `kind: 'app'`: the app's declared trigger id (e.g. 'email_received').
     * Named with `triggerApp...` prefix to mirror Workflow's columns and
     * avoid colliding with the row's own `id`. NULL for other kinds.
     */
    triggerAppTriggerId: text(),

    /**
     * For `kind: 'app'`: AppInstallation row id. FK with cascade —
     * uninstalling the app deletes the trigger.
     */
    triggerInstallationId: text().references((): AnyPgColumn => AppInstallation.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    /**
     * For `kind: 'app'`: optional connection scope. Loose match — a row
     * with NULL matches any connection; with a value, must equal.
     * Shared with app triggers — NOT used by the webhook-endpoint trigger.
     */
    triggerConnectionId: text(),

    /**
     * For `kind: 'webhook-endpoint'`: the WebhookEndpoint this trigger fires on
     * (required — paired with `triggerTopic`). NULL for all other kinds.
     */
    triggerWebhookEndpointId: text().references((): AnyPgColumn => WebhookEndpoint.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /**
     * For `kind: 'webhook-endpoint'`: the topic (`orders/create`) this trigger
     * fires on. NULL for all other kinds.
     */
    triggerTopic: text(),

    /* ---------- Kind-specific tail ---------- */

    /**
     * Shape per kind:
     *   scheduled: ScheduledTriggerConfig
     *     ({ triggerInterval, timeBetweenTriggers, customCron?, timezone? })
     *   event:    { filter?: Record<string, unknown> }
     *   app:      { polling?: { intervalMinutes, minIntervalMinutes?, cron? },
     *               userInputs?: Record<string, unknown>,
     *               filter?: Record<string, unknown> }
     */
    config: jsonb().$type<Record<string, unknown>>().default({}).notNull(),

    /**
     * Per-trigger prompt addendum (Tiptap JSON or plain text). Layered on
     * top of the agent's base prompt at run time.
     */
    instructions: jsonb().$type<Record<string, unknown>>(),

    /** Observability — cheap reads for the list view. */
    lastFiredAt: timestamp({ precision: 3 }),
    lastErrorAt: timestamp({ precision: 3 }),
    lastError: text(),

    /** Audit only. No permission semantics. */
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('AgentTrigger_agentId_idx').using('btree', table.agentId.asc().nullsLast()),
    index('AgentTrigger_orgId_event_crud_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.enabled.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast(),
      table.triggerType.asc().nullsLast()
    ),
    index('AgentTrigger_orgId_event_direct_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.enabled.asc().nullsLast(),
      table.eventType.asc().nullsLast()
    ),
    index('AgentTrigger_orgId_app_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.enabled.asc().nullsLast(),
      table.triggerAppId.asc().nullsLast(),
      table.triggerAppTriggerId.asc().nullsLast(),
      table.triggerInstallationId.asc().nullsLast()
    ),
    index('AgentTrigger_orgId_kind_enabled_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.kind.asc().nullsLast(),
      table.enabled.asc().nullsLast()
    ),
    index('AgentTrigger_orgId_webhook_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.enabled.asc().nullsLast(),
      table.triggerWebhookEndpointId.asc().nullsLast(),
      table.triggerTopic.asc().nullsLast()
    ),
  ]
)

export type AgentTriggerEntity = typeof AgentTrigger.$inferSelect
export type AgentTriggerInsert = typeof AgentTrigger.$inferInsert
