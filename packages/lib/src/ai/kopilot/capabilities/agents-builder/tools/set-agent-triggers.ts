// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/set-agent-triggers.ts

import {
  type AgentTriggerInput,
  AgentTriggerService,
  type CrudEventTriggerInput,
  type ScheduledTriggerInput,
} from '../../../../../agents/agent-trigger-service'
import { onCacheEvent } from '../../../../../cache'
import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import { mdToBlocks } from '../../../../../kb/markdown'
import type { ScheduledTriggerConfig } from '../../../../../workflows/cron-pattern'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'
import { buildAgentRailUpdate } from '../snapshot'

const MAX_TRIGGERS = 10
const INSTRUCTIONS_MAX = 2000
const EVENT_TRIGGER_TYPES = ['created', 'updated', 'deleted'] as const

interface ParsedScheduledTrigger {
  kind: 'scheduled'
  cron?: string
  everyMinutes?: number
  everyHours?: number
  everyDays?: number
  timezone?: string
  instructions?: string
}

interface ParsedEventTrigger {
  kind: 'event'
  triggerType: 'created' | 'updated' | 'deleted'
  entityDefinitionSlug: string
  instructions?: string
}

type ParsedTrigger = ParsedScheduledTrigger | ParsedEventTrigger

/**
 * Replace the agent's trigger set. Pass the FULL desired list — anything not
 * in `triggers` is removed (and its BullMQ scheduler is torn down via the
 * service). v1 covers two kinds:
 *
 *  - `scheduled`: cron or `everyN{Minutes,Hours,Days}` shorthand, optional
 *    timezone, optional per-fire instructions.
 *  - `event`: CRUD events (created / updated / deleted) for a single entity
 *    type, referenced by apiSlug / entityType / id.
 *
 * `app` and `event-direct` kinds are admin-driven and ship via the rail UI,
 * not this builder tool.
 */
export function createSetAgentTriggersTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_agent_triggers',
    displayName: 'Set agent triggers',
    description: `Replace the agent's trigger set with the provided list.

Triggers tell the agent when to run autonomously. Default: no triggers — the
agent only responds to direct chat. Add triggers when the admin asks the
agent to react to records or run on a schedule.

Two supported kinds:

- \`scheduled\`: runs on a clock. Pass either \`cron\` (5- or 6-field cron
  expression) OR one of \`everyMinutes\` / \`everyHours\` / \`everyDays\`.
  Optional \`timezone\` (IANA name). Use \`instructions\` to tell the agent
  what to do each fire (e.g. "summarize new replies in the last day").
- \`event\`: fires when a record is created / updated / deleted. Pass
  \`triggerType\` and \`entityDefinitionSlug\` (the apiSlug from
  \`list_entities\` — e.g. \`ticket\`, \`contact\`).

This call REPLACES the full set. To add one trigger to an agent that already
has two, send all three in the call.`,
    parameters: {
      type: 'object',
      properties: {
        triggers: {
          type: 'array',
          maxItems: MAX_TRIGGERS,
          description: 'Full desired set of triggers. Empty array removes all triggers.',
          items: {
            oneOf: [
              {
                type: 'object',
                properties: {
                  kind: { const: 'scheduled' },
                  cron: {
                    type: 'string',
                    description:
                      'BullMQ cron pattern (5- or 6-field). Mutually exclusive with everyN*.',
                  },
                  everyMinutes: { type: 'integer', minimum: 1, maximum: 59 },
                  everyHours: { type: 'integer', minimum: 1, maximum: 23 },
                  everyDays: { type: 'integer', minimum: 1, maximum: 30 },
                  timezone: {
                    type: 'string',
                    description: 'IANA timezone (e.g. "America/Los_Angeles")',
                  },
                  instructions: { type: 'string', maxLength: INSTRUCTIONS_MAX },
                },
                required: ['kind'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { const: 'event' },
                  triggerType: { type: 'string', enum: EVENT_TRIGGER_TYPES },
                  entityDefinitionSlug: {
                    type: 'string',
                    description:
                      'apiSlug / entityType / id from `list_entities` (e.g. `ticket`, `contact`).',
                  },
                  instructions: { type: 'string', maxLength: INSTRUCTIONS_MAX },
                },
                required: ['kind', 'triggerType', 'entityDefinitionSlug'],
                additionalProperties: false,
              },
            ],
          },
        },
      },
      required: ['triggers'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { sessionContext } = getDeps()
      const agentRef = findRef(sessionContext, 'agent')
      if (!agentRef?.id) {
        return {
          success: false,
          output: null,
          error: 'No agent in session context — this tool only runs on the builder page.',
        }
      }

      const rawTriggers = (args.triggers ?? []) as ParsedTrigger[]
      if (!Array.isArray(rawTriggers)) {
        return { success: false, output: null, error: 'triggers must be an array' }
      }
      if (rawTriggers.length > MAX_TRIGGERS) {
        return {
          success: false,
          output: null,
          error: `Too many triggers (max ${MAX_TRIGGERS}, got ${rawTriggers.length}).`,
        }
      }

      // Resolve each parsed trigger into a typed AgentTriggerInput. Entity
      // slugs resolve through the org resources cache so the LLM never has
      // to pass cuid-style ids.
      const resolved: Array<{ input: AgentTriggerInput; instructions?: string }> = []
      for (let i = 0; i < rawTriggers.length; i++) {
        const t = rawTriggers[i]
        const built = await buildTriggerInput(t, agentDeps.organizationId, i)
        if ('error' in built) return { success: false, output: null, error: built.error }
        resolved.push({ input: built.input, instructions: built.instructions })
      }

      const service = new AgentTriggerService()
      const existing = await service.listForAgent(agentRef.id, agentDeps.organizationId)

      // Replace-all: tear down existing, recreate. Simpler than diffing; the
      // service's scheduler upserts handle BullMQ churn.
      for (const row of existing) {
        await service.deleteTrigger(row.id, agentDeps.organizationId)
      }

      const created: string[] = []
      for (const { input, instructions } of resolved) {
        const row = await service.createTrigger({
          agentId: agentRef.id,
          organizationId: agentDeps.organizationId,
          createdById: agentDeps.userId,
          enabled: true,
          instructions: instructions ? instructionsToDoc(instructions) : null,
          trigger: input,
        })
        created.push(row.id)
      }

      await onCacheEvent('agent.updated', { orgId: agentDeps.organizationId })

      return {
        success: true,
        output: {
          agentId: agentRef.id,
          triggerIds: created,
          removed: existing.length,
          ...buildAgentRailUpdate({
            agentId: agentRef.id,
            changed: ['identity'],
            summary: `${created.length} trigger${created.length === 1 ? '' : 's'} set (${existing.length} removed)`,
          }),
        },
      }
    },
  }
}

interface BuiltTrigger {
  input: AgentTriggerInput
  instructions?: string
}

async function buildTriggerInput(
  t: ParsedTrigger,
  organizationId: string,
  index: number
): Promise<BuiltTrigger | { error: string }> {
  if (!t || typeof t !== 'object' || !('kind' in t)) {
    return { error: `triggers[${index}]: missing 'kind'` }
  }

  if (t.kind === 'scheduled') {
    const config = buildScheduledConfig(t)
    if ('error' in config) return { error: `triggers[${index}]: ${config.error}` }
    const input: ScheduledTriggerInput = { kind: 'scheduled', config: config.config }
    return { input, instructions: t.instructions }
  }

  if (t.kind === 'event') {
    if (!EVENT_TRIGGER_TYPES.includes(t.triggerType)) {
      return {
        error: `triggers[${index}]: triggerType must be one of ${EVENT_TRIGGER_TYPES.join(', ')}`,
      }
    }
    if (!t.entityDefinitionSlug || typeof t.entityDefinitionSlug !== 'string') {
      return { error: `triggers[${index}]: entityDefinitionSlug is required for event triggers` }
    }
    const resource = await findCachedResource(organizationId, t.entityDefinitionSlug)
    if (!resource) {
      return {
        error: `triggers[${index}]: unknown entityDefinitionSlug "${t.entityDefinitionSlug}". Use the apiSlug from list_entities.`,
      }
    }
    const input: CrudEventTriggerInput = {
      kind: 'event',
      triggerType: t.triggerType,
      entityDefinitionId: resource.id,
    }
    return { input, instructions: t.instructions }
  }

  return { error: `triggers[${index}]: unsupported kind "${(t as { kind: string }).kind}"` }
}

function buildScheduledConfig(
  t: ParsedScheduledTrigger
): { config: ScheduledTriggerConfig } | { error: string } {
  const { cron, everyMinutes, everyHours, everyDays, timezone } = t
  const everyCount = [everyMinutes, everyHours, everyDays].filter((v) => v !== undefined).length

  if (cron && everyCount > 0) {
    return { error: 'pass either cron OR one everyN* field, not both' }
  }
  if (!cron && everyCount === 0) {
    return {
      error: 'scheduled trigger requires cron or one of everyMinutes / everyHours / everyDays',
    }
  }
  if (everyCount > 1) {
    return { error: 'pass only one of everyMinutes / everyHours / everyDays' }
  }

  if (cron) {
    return {
      config: { triggerInterval: 'custom', timeBetweenTriggers: {}, customCron: cron, timezone },
    }
  }
  if (everyMinutes !== undefined) {
    return {
      config: {
        triggerInterval: 'minutes',
        timeBetweenTriggers: { minutes: everyMinutes, isConstant: true },
        timezone,
      },
    }
  }
  if (everyHours !== undefined) {
    return {
      config: {
        triggerInterval: 'hours',
        timeBetweenTriggers: { hours: everyHours, isConstant: true },
        timezone,
      },
    }
  }
  // everyDays
  return {
    config: {
      triggerInterval: 'days',
      timeBetweenTriggers: { days: everyDays, isConstant: true },
      timezone,
    },
  }
}

/** Wrap a single-line instructions string in the editor's doc shape. */
function instructionsToDoc(text: string): Record<string, unknown> {
  return { type: 'doc', content: mdToBlocks(text) }
}
