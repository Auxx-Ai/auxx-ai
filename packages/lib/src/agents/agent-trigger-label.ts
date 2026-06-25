// packages/lib/src/agents/agent-trigger-label.ts

import cronstrue from 'cronstrue'
import type { ScheduledTriggerConfig } from '../workflows/cron-pattern'

/**
 * Derives a human-readable label for a trigger row. The agent UI calls
 * this in the triggers table — there is no `name` column on AgentTrigger.
 *
 * Pure, synchronous, and `/client`-safe (no DB / queues / lib imports).
 */
export function getTriggerLabel(trigger: {
  kind: string
  enabled: boolean
  triggerType: string | null
  entityDefinitionId: string | null
  eventType: string | null
  triggerAppId: string | null
  triggerAppTriggerId: string | null
  triggerTopic?: string | null
  config: Record<string, unknown>
}): string {
  return baseLabel(trigger)
}

function baseLabel(trigger: {
  kind: string
  triggerType: string | null
  entityDefinitionId: string | null
  eventType: string | null
  triggerAppId: string | null
  triggerAppTriggerId: string | null
  triggerTopic?: string | null
  config: Record<string, unknown>
}): string {
  switch (trigger.kind) {
    case 'scheduled':
      return scheduledLabel(trigger.config as ScheduledTriggerConfig)
    case 'event':
      if (trigger.entityDefinitionId && trigger.triggerType) {
        return `On ${trigger.entityDefinitionId}:${trigger.triggerType}`
      }
      if (trigger.eventType) return `On ${trigger.eventType}`
      return 'On event'
    case 'app':
      if (trigger.triggerAppId && trigger.triggerAppTriggerId) {
        return `${trigger.triggerAppId} · ${trigger.triggerAppTriggerId}`
      }
      return 'App trigger'
    case 'webhook-endpoint':
      return trigger.triggerTopic ? `Webhook · ${trigger.triggerTopic}` : 'Webhook endpoint'
    case 'mention':
      return 'Mention'
    case 'assignment':
      return 'Assignment'
    case 'dm':
      return 'Direct message'
    default:
      return trigger.kind
  }
}

function scheduledLabel(config: ScheduledTriggerConfig): string {
  if (config.triggerInterval === 'custom') {
    if (!config.customCron) return 'Custom schedule'
    return humanizeCron(config.customCron)
  }
  const value = config.timeBetweenTriggers[config.triggerInterval]
  if (typeof value !== 'number' || value <= 0) {
    return `Every ${config.triggerInterval}`
  }
  const unit = value === 1 ? config.triggerInterval.replace(/s$/, '') : config.triggerInterval
  return `Every ${value} ${unit}`
}

/**
 * Cron expressions in our system can be 5-field (standard) or 6-field
 * (BullMQ, with leading seconds). cronstrue only parses 5-field reliably,
 * so we strip the seconds slot when present before describing.
 */
function humanizeCron(expr: string): string {
  const trimmed = expr.trim()
  const fields = trimmed.split(/\s+/)
  const fiveField = fields.length === 6 ? fields.slice(1).join(' ') : trimmed
  try {
    return cronstrue.toString(fiveField, { verbose: false, use24HourTimeFormat: false })
  } catch {
    return `Custom (${expr})`
  }
}
