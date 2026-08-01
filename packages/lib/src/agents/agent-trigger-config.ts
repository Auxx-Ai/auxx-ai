// packages/lib/src/agents/agent-trigger-config.ts

import type { ScheduledTriggerConfig } from '../workflows/cron-pattern'

/**
 * `AgentTrigger.config` is `jsonb().$type<Record<string, unknown>>()` because
 * its shape varies per `kind` and nothing inside the blob discriminates it —
 * the discriminator is the sibling `kind` column. Readers therefore have to
 * narrow at the boundary; an `as ScheduledTriggerConfig` cast both lied to the
 * compiler and let a malformed row reach `config.timeBetweenTriggers[…]`, which
 * is a TypeError rather than a bad label.
 *
 * Pure and dependency-free so the `/client`-safe label helper can use it too.
 */

const TRIGGER_INTERVALS = [
  'minutes',
  'hours',
  'days',
  'weeks',
  'custom',
] as const satisfies readonly ScheduledTriggerConfig['triggerInterval'][]

const INTERVAL_UNITS = ['minutes', 'hours', 'days', 'weeks'] as const

function isTriggerInterval(value: unknown): value is ScheduledTriggerConfig['triggerInterval'] {
  return typeof value === 'string' && (TRIGGER_INTERVALS as readonly string[]).includes(value)
}

function parseTimeBetweenTriggers(value: unknown): ScheduledTriggerConfig['timeBetweenTriggers'] {
  const out: ScheduledTriggerConfig['timeBetweenTriggers'] = {}
  if (typeof value !== 'object' || value === null) return out
  const src = value as Record<string, unknown>
  for (const unit of INTERVAL_UNITS) {
    const v = src[unit]
    if (typeof v === 'number' || typeof v === 'string') out[unit] = v
  }
  if (typeof src.isConstant === 'boolean') out.isConstant = src.isConstant
  return out
}

/**
 * Narrow a `kind: 'scheduled'` trigger's `config` blob to
 * {@link ScheduledTriggerConfig}. Returns `null` when the blob carries no usable
 * `triggerInterval` — the one field every downstream reader dereferences.
 */
export function parseScheduledTriggerConfig(
  config: Record<string, unknown> | null | undefined
): ScheduledTriggerConfig | null {
  if (!config) return null
  if (!isTriggerInterval(config.triggerInterval)) return null
  return {
    triggerInterval: config.triggerInterval,
    timeBetweenTriggers: parseTimeBetweenTriggers(config.timeBetweenTriggers),
    ...(typeof config.customCron === 'string' ? { customCron: config.customCron } : {}),
    ...(typeof config.timezone === 'string' ? { timezone: config.timezone } : {}),
  }
}
