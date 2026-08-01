// packages/lib/src/agents/agent-trigger-service.ts

import {
  type AgentTriggerEntity,
  type Database,
  database as defaultDb,
  schema,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq } from 'drizzle-orm'
import { BadRequestError } from '../errors'
import { getQueue, Queues } from '../jobs/queues'
import { convertToCronPattern, type ScheduledTriggerConfig } from '../workflows/cron-pattern'
import { parseScheduledTriggerConfig } from './agent-trigger-config'

const logger = createScopedLogger('agent-trigger-service')

/** Trigger kinds. */
export type AgentTriggerKind =
  | 'scheduled'
  | 'event'
  | 'app'
  | 'mention'
  | 'assignment'
  | 'dm'
  | 'webhook-endpoint'

/** CRUD-mode event triggerType. */
export type AgentEventTriggerType = 'created' | 'updated' | 'deleted'

/** Allowlist of direct-match event types Phase 2 supports. Grow as needed. */
export const ALLOWED_DIRECT_EVENT_TYPES = [
  'ticket:assignee:added',
  'ticket:assignee:removed',
  'ticket:status:changed',
  'ticket:reply:created',
] as const
export type AllowedDirectEventType = (typeof ALLOWED_DIRECT_EVENT_TYPES)[number]

export interface ScheduledTriggerInput {
  kind: 'scheduled'
  config: ScheduledTriggerConfig
}

export interface CrudEventTriggerInput {
  kind: 'event'
  triggerType: AgentEventTriggerType
  entityDefinitionId: string
  filter?: Record<string, unknown>
}

export interface AppTriggerInput {
  kind: 'app'
  triggerAppId: string
  triggerAppTriggerId: string
  triggerInstallationId: string
  triggerConnectionId?: string
  userInputs?: Record<string, unknown>
  filter?: Record<string, unknown>
  polling?: {
    intervalMinutes: number
    minIntervalMinutes?: number
    cron?: string
  }
}

/** Phase 1.5: fires when this agent is referenced in a comment. */
export interface MentionTriggerInput {
  kind: 'mention'
}

/** Phase 1.5: fires when this agent is assigned to a ticket. */
export interface AssignmentTriggerInput {
  kind: 'assignment'
}

/** Phase 2: fires when a user direct-messages this agent (Chat tab, composer sender picker). */
export interface DmTriggerInput {
  kind: 'dm'
}

/** Fires on a generic inbound `WebhookEndpoint` delivery, optionally scoped to a topic. */
export interface WebhookTriggerInput {
  kind: 'webhook-endpoint'
  triggerWebhookEndpointId: string
  triggerTopic: string
  filter?: Record<string, unknown>
}

export type AgentTriggerInput =
  | ScheduledTriggerInput
  | CrudEventTriggerInput
  | AppTriggerInput
  | MentionTriggerInput
  | AssignmentTriggerInput
  | DmTriggerInput
  | WebhookTriggerInput

export interface CreateAgentTriggerInput {
  agentId: string
  organizationId: string
  /** Audit only. */
  createdById: string
  /** Per-trigger prompt addendum (Tiptap JSON or plain text). */
  instructions?: Record<string, unknown> | null
  /** When omitted defaults to true. */
  enabled?: boolean
  /** Kind + kind-specific fields. */
  trigger: AgentTriggerInput
}

export interface UpdateAgentTriggerInput {
  enabled?: boolean
  instructions?: Record<string, unknown> | null
  /** Replace kind-specific config. The `kind` itself cannot change. */
  trigger?: AgentTriggerInput
}

const SCHEDULED_QUEUE = Queues.scheduledTriggerQueue
const APP_POLLING_QUEUE = Queues.appPollingTriggerQueue

function scheduledSchedulerId(triggerId: string): string {
  return `agent-trigger-${triggerId}-scheduled`
}

function pollingSchedulerId(triggerId: string): string {
  return `agent-trigger-${triggerId}-polling`
}

/** Split a kind-specific input into (column patch, config tail). */
function partitionTriggerInput(trigger: AgentTriggerInput): {
  kind: AgentTriggerKind
  columns: {
    triggerType: string | null
    entityDefinitionId: string | null
    eventType: string | null
    triggerAppId: string | null
    triggerAppTriggerId: string | null
    triggerInstallationId: string | null
    triggerConnectionId: string | null
    triggerWebhookEndpointId: string | null
    triggerTopic: string | null
  }
  config: Record<string, unknown>
} {
  const empty = {
    triggerType: null,
    entityDefinitionId: null,
    eventType: null,
    triggerAppId: null,
    triggerAppTriggerId: null,
    triggerInstallationId: null,
    triggerConnectionId: null,
    triggerWebhookEndpointId: null,
    triggerTopic: null,
  }

  if (trigger.kind === 'scheduled') {
    return {
      kind: 'scheduled',
      columns: { ...empty },
      config: { ...trigger.config },
    }
  }

  if (trigger.kind === 'event') {
    return {
      kind: 'event',
      columns: {
        ...empty,
        triggerType: trigger.triggerType,
        entityDefinitionId: trigger.entityDefinitionId,
      },
      config: trigger.filter ? { filter: trigger.filter } : {},
    }
  }

  if (trigger.kind === 'mention' || trigger.kind === 'assignment' || trigger.kind === 'dm') {
    return {
      kind: trigger.kind,
      columns: { ...empty },
      config: {},
    }
  }

  if (trigger.kind === 'webhook-endpoint') {
    return {
      kind: 'webhook-endpoint',
      columns: {
        ...empty,
        triggerWebhookEndpointId: trigger.triggerWebhookEndpointId,
        triggerTopic: trigger.triggerTopic,
      },
      config: trigger.filter ? { filter: trigger.filter } : {},
    }
  }

  // app
  const cfg: Record<string, unknown> = {}
  if (trigger.polling) cfg.polling = trigger.polling
  if (trigger.userInputs) cfg.userInputs = trigger.userInputs
  if (trigger.filter) cfg.filter = trigger.filter
  return {
    kind: 'app',
    columns: {
      ...empty,
      triggerAppId: trigger.triggerAppId,
      triggerAppTriggerId: trigger.triggerAppTriggerId,
      triggerInstallationId: trigger.triggerInstallationId,
      triggerConnectionId: trigger.triggerConnectionId ?? null,
    },
    config: cfg,
  }
}

/**
 * Lifecycle service for `AgentTrigger` rows. Owns scheduler upserts /
 * removals so callers (tRPC routes, lifecycle hooks) don't reach into
 * BullMQ directly.
 */
export class AgentTriggerService {
  private get scheduledQueue() {
    return getQueue(SCHEDULED_QUEUE)
  }
  private get appPollingQueue() {
    return getQueue(APP_POLLING_QUEUE)
  }

  constructor(private db: Database = defaultDb as Database) {}

  /** Insert a new trigger row + wire up scheduler(s). */
  async createTrigger(input: CreateAgentTriggerInput): Promise<AgentTriggerEntity> {
    const { kind, columns, config } = partitionTriggerInput(input.trigger)
    const enabled = input.enabled ?? true

    const [row] = await this.db
      .insert(schema.AgentTrigger)
      .values({
        agentId: input.agentId,
        organizationId: input.organizationId,
        kind,
        enabled,
        ...columns,
        config,
        instructions: input.instructions ?? null,
        createdById: input.createdById,
      })
      .returning()

    if (!row) throw new Error('Failed to insert AgentTrigger row')

    await this.syncSchedulers(row)
    return row
  }

  /** Update an existing trigger row + re-sync scheduler(s). */
  async updateTrigger(
    triggerId: string,
    organizationId: string,
    patch: UpdateAgentTriggerInput
  ): Promise<AgentTriggerEntity> {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.enabled !== undefined) set.enabled = patch.enabled
    if (patch.instructions !== undefined) set.instructions = patch.instructions

    if (patch.trigger) {
      const { columns, config } = partitionTriggerInput(patch.trigger)
      Object.assign(set, columns)
      set.config = config
    }

    const [row] = await this.db
      .update(schema.AgentTrigger)
      .set(set)
      .where(
        and(
          eq(schema.AgentTrigger.id, triggerId),
          eq(schema.AgentTrigger.organizationId, organizationId)
        )
      )
      .returning()

    if (!row) throw new Error(`AgentTrigger not found: ${triggerId}`)

    await this.syncSchedulers(row)
    return row
  }

  /** Remove the trigger row + any associated scheduler. */
  async deleteTrigger(triggerId: string, organizationId: string): Promise<void> {
    await this.removeScheduledScheduler(triggerId)
    await this.removePollingScheduler(triggerId)

    await this.db
      .delete(schema.AgentTrigger)
      .where(
        and(
          eq(schema.AgentTrigger.id, triggerId),
          eq(schema.AgentTrigger.organizationId, organizationId)
        )
      )
  }

  /** Load one row (org-scoped). */
  async getTrigger(triggerId: string, organizationId: string): Promise<AgentTriggerEntity | null> {
    const [row] = await this.db
      .select()
      .from(schema.AgentTrigger)
      .where(
        and(
          eq(schema.AgentTrigger.id, triggerId),
          eq(schema.AgentTrigger.organizationId, organizationId)
        )
      )
      .limit(1)
    return row ?? null
  }

  /** List triggers for an agent, newest first. */
  async listForAgent(agentId: string, organizationId: string): Promise<AgentTriggerEntity[]> {
    return this.db
      .select()
      .from(schema.AgentTrigger)
      .where(
        and(
          eq(schema.AgentTrigger.agentId, agentId),
          eq(schema.AgentTrigger.organizationId, organizationId)
        )
      )
      .orderBy(desc(schema.AgentTrigger.createdAt))
  }

  /** Mark a successful fire (called from worker). */
  async recordFire(triggerId: string): Promise<void> {
    await this.db
      .update(schema.AgentTrigger)
      .set({ lastFiredAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.AgentTrigger.id, triggerId))
  }

  /** Mark a failure (called from worker). Truncates message to 500 chars. */
  async recordError(triggerId: string, message: string): Promise<void> {
    await this.db
      .update(schema.AgentTrigger)
      .set({
        lastErrorAt: new Date(),
        lastError: message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(schema.AgentTrigger.id, triggerId))
  }

  /**
   * Upsert any scheduler this row needs. No-ops for kinds without a
   * scheduler (event, app-webhook). Removes the scheduler if the row is
   * disabled or no longer qualifies.
   */
  private async syncSchedulers(row: AgentTriggerEntity): Promise<void> {
    if (row.kind === 'scheduled') {
      if (row.enabled) {
        await this.upsertScheduledScheduler(row)
      } else {
        await this.removeScheduledScheduler(row.id)
      }
      return
    }

    if (row.kind === 'app') {
      const polling = (row.config as { polling?: unknown }).polling
      if (row.enabled && polling) {
        // Agent-only polling scheduler is deferred — workflow polling fans
        // out to agents already (see `polling-trigger-job.ts`). Logged here
        // so admins know an agent-only polling trigger is inert until the
        // dedicated polling worker ships.
        logger.warn(
          'Agent-only app polling is deferred — agent will only fire when a workflow with the same poll exists',
          {
            triggerId: row.id,
            appId: row.triggerAppId,
            triggerAppTriggerId: row.triggerAppTriggerId,
          }
        )
      }
      await this.removePollingScheduler(row.id)
      return
    }
    // event-kind: no scheduler.
  }

  private async upsertScheduledScheduler(row: AgentTriggerEntity): Promise<void> {
    const config = parseScheduledTriggerConfig(row.config)
    if (!config) {
      throw new BadRequestError(
        `Scheduled trigger ${row.id} has no usable schedule config (missing or invalid triggerInterval).`
      )
    }
    const pattern = convertToCronPattern(config)
    const schedulerId = scheduledSchedulerId(row.id)

    await this.scheduledQueue.upsertJobScheduler(
      schedulerId,
      { pattern, tz: config.timezone },
      {
        name: 'executeAgentScheduledTrigger',
        data: {
          agentTriggerId: row.id,
          agentId: row.agentId,
          organizationId: row.organizationId,
        },
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      }
    )

    logger.info('Upserted agent scheduled-trigger scheduler', {
      triggerId: row.id,
      schedulerId,
      pattern,
    })
  }

  async removeScheduledScheduler(triggerId: string): Promise<void> {
    const schedulerId = scheduledSchedulerId(triggerId)
    try {
      const schedulers = await this.scheduledQueue.getJobSchedulers()
      if (schedulers.some((s) => s.id === schedulerId)) {
        await this.scheduledQueue.removeJobScheduler(schedulerId)
        logger.info('Removed agent scheduled-trigger scheduler', { triggerId, schedulerId })
      }
    } catch (err) {
      logger.warn('Failed to remove scheduled scheduler', {
        triggerId,
        schedulerId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private async upsertPollingScheduler(row: AgentTriggerEntity): Promise<void> {
    const polling = (row.config as { polling?: { intervalMinutes?: number; cron?: string } })
      .polling
    if (!polling) return

    let pattern: string
    if (polling.cron) {
      pattern = polling.cron
    } else if (polling.intervalMinutes && polling.intervalMinutes > 0) {
      pattern = `0 */${polling.intervalMinutes} * * * *`
    } else {
      throw new Error('App polling trigger requires intervalMinutes or cron')
    }

    const schedulerId = pollingSchedulerId(row.id)
    await this.appPollingQueue.upsertJobScheduler(
      schedulerId,
      { pattern },
      {
        name: 'executeAgentAppPollingTrigger',
        data: {
          agentTriggerId: row.id,
          agentId: row.agentId,
          organizationId: row.organizationId,
          appId: row.triggerAppId,
          triggerId: row.triggerAppTriggerId,
          installationId: row.triggerInstallationId,
          connectionId: row.triggerConnectionId,
          userInputs: (row.config as { userInputs?: Record<string, unknown> }).userInputs ?? {},
        },
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      }
    )

    logger.info('Upserted agent app-polling-trigger scheduler', {
      triggerId: row.id,
      schedulerId,
      pattern,
    })
  }

  async removePollingScheduler(triggerId: string): Promise<void> {
    const schedulerId = pollingSchedulerId(triggerId)
    try {
      const schedulers = await this.appPollingQueue.getJobSchedulers()
      if (schedulers.some((s) => s.id === schedulerId)) {
        await this.appPollingQueue.removeJobScheduler(schedulerId)
        logger.info('Removed agent app-polling-trigger scheduler', { triggerId, schedulerId })
      }
    } catch (err) {
      logger.warn('Failed to remove polling scheduler', {
        triggerId,
        schedulerId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
