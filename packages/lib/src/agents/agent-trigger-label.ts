// packages/lib/src/agents/agent-trigger-label.ts

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
  config: Record<string, unknown>
}): string {
  const base = baseLabel(trigger)
  return trigger.enabled ? base : `${base} (paused)`
}

function baseLabel(trigger: {
  kind: string
  triggerType: string | null
  entityDefinitionId: string | null
  eventType: string | null
  triggerAppId: string | null
  triggerAppTriggerId: string | null
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
    default:
      return trigger.kind
  }
}

function scheduledLabel(config: ScheduledTriggerConfig): string {
  if (config.triggerInterval === 'custom') {
    return config.customCron ? `Custom (${config.customCron})` : 'Custom schedule'
  }
  const value = config.timeBetweenTriggers[config.triggerInterval]
  if (typeof value !== 'number' || value <= 0) {
    return `Every ${config.triggerInterval}`
  }
  const unit = value === 1 ? config.triggerInterval.replace(/s$/, '') : config.triggerInterval
  return `Every ${value} ${unit}`
}
