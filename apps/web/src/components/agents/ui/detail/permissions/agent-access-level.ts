// apps/web/src/components/agents/ui/detail/permissions/agent-access-level.ts

import type { AgentAccessLevel } from '@auxx/database'
import type { BadgeProps } from '@auxx/ui/components/badge'

/**
 * The four exact rungs an agent policy can express, ascending
 * (plan 19 §0.5 / §2.3). Agent policy is **SET semantics**, not additive:
 * every lookup returns exactly one of these — there is no `inherit`, and
 * `none` is a deliberate deny rather than an unset value.
 */
export const AGENT_ACCESS_LEVELS: AgentAccessLevel[] = ['none', 'read', 'read_write', 'full']

/** Ascending rank, for comparing a requested rung against an allowed one. */
export const AGENT_ACCESS_RANK: Record<AgentAccessLevel, number> = {
  none: 0,
  read: 1,
  read_write: 2,
  full: 3,
}

interface AgentAccessLevelMeta {
  /** The label the plan uses verbatim — `None / Read / Read + Write / Full`. */
  label: string
  /** One line of what the rung authorizes. */
  helper: string
  variant: NonNullable<BadgeProps['variant']>
}

/**
 * Labels are fixed by plan 19 §0.5 and must not drift into the human
 * `Inherit / Read / Edit / Full` vocabulary — an agent never inherits, so
 * showing `None` as "Inherit" (the doc 16 §10 bug, one screen over) would
 * misdescribe a deny as an unset default.
 */
export const AGENT_ACCESS_LEVEL_META: Record<AgentAccessLevel, AgentAccessLevelMeta> = {
  none: { label: 'None', helper: 'Denied — cannot discover or use', variant: 'outline' },
  read: { label: 'Read', helper: 'List, read, and search', variant: 'sky' },
  read_write: {
    label: 'Read + Write',
    helper: 'Read plus create, update, and delete',
    variant: 'amber',
  },
  full: {
    // Schema administration rides on this rung but has no native tool yet, so the
    // helper says so rather than the tab carrying a footnote about it.
    label: 'Full',
    helper: 'Read + Write plus administration and settings — schema administration has no tool yet',
    variant: 'green',
  },
}

/** `None / Read / Read + Write / Full` for a rung. */
export function agentLevelLabel(level: AgentAccessLevel): string {
  return AGENT_ACCESS_LEVEL_META[level].label
}

/**
 * The `{ default, overrides }` shape every agent-policy keyspace uses. Declared
 * structurally (string-keyed, optional `overrides`) so it accepts both the draft
 * `AgentPermissionPolicy` and a published `AgentVersion.permissionPolicy`
 * snapshot without a cast.
 */
export interface ExactAgentPolicyLike {
  default: AgentAccessLevel
  overrides?: Partial<Record<string, AgentAccessLevel>>
}

/**
 * Resolve one key against a keyspace — the client mirror of the runtime lookup:
 * an explicit override, else the keyspace default. Never returns `undefined`,
 * because the policy is total by construction (a definition or resource created
 * after publication still has a deterministic posture).
 */
export function resolveAgentLevel(
  policy: ExactAgentPolicyLike | undefined,
  key: string,
  fallback: AgentAccessLevel
): AgentAccessLevel {
  if (!policy) return fallback
  return policy.overrides?.[key] ?? policy.default
}

/** Whether the key carries an explicit override (vs. taking the default). */
export function hasAgentOverride(policy: ExactAgentPolicyLike | undefined, key: string): boolean {
  return policy?.overrides?.[key] !== undefined
}
