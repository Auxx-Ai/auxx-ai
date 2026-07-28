// apps/web/src/components/agents/ui/detail/permissions/agent-access-level.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { BadgeProps } from '@auxx/ui/components/badge'
import { permissionLabel } from '~/components/permissions/ui/level-labels'

/**
 * The four exact rungs an agent policy can express, ascending
 * (plan 19 §0.5 / §2.3). Agent policy is **SET semantics**, not additive:
 * every lookup returns exactly one of these — there is no `inherit`, and
 * `none` is a deliberate deny rather than an unset value. Rank comparisons use
 * the shared `PERMISSION_RANK`; plan 26 Phase 2 collapsed the private agent
 * spelling (and its private rank table) into `ResourcePermission`.
 */
export const AGENT_ACCESS_LEVELS: ResourcePermission[] = ['none', 'view', 'edit', 'admin']

interface AgentRungMeta {
  /** The rung's name, from the one shared display vocabulary (plan 26 §2.1). */
  label: string
  /** One line of what the rung authorizes. */
  helper: string
  variant: NonNullable<BadgeProps['variant']>
}

/**
 * Rung names come from the shared ladder vocabulary; only the helper line and
 * badge colour are agent-specific. What plan 19 §0.5/§7 actually forbids is
 * showing `None` as "Inherit" (the doc 16 §10 bug, one screen over) — an agent
 * never inherits, so a deny must never read as an unset default.
 */
export const AGENT_ACCESS_LEVEL_META: Record<ResourcePermission, AgentRungMeta> = {
  none: {
    label: permissionLabel('none'),
    helper: 'Denied — cannot discover or use',
    variant: 'outline',
  },
  view: { label: permissionLabel('view'), helper: 'List, read, and search', variant: 'sky' },
  edit: {
    label: permissionLabel('edit'),
    helper: 'Read plus create, update, and delete',
    variant: 'amber',
  },
  admin: {
    // Schema administration rides on this rung but has no native tool yet, so the
    // helper says so rather than the tab carrying a footnote about it.
    label: permissionLabel('admin'),
    helper:
      'Read and write, plus administration and settings — schema administration has no tool yet',
    variant: 'green',
  },
}

/**
 * The `{ default, overrides }` shape every agent-policy keyspace uses. Declared
 * structurally (string-keyed, optional `overrides`) so it accepts both the draft
 * `AgentPermissionPolicy` and a published `AgentVersion.permissionPolicy`
 * snapshot without a cast.
 */
export interface ExactAgentPolicyLike {
  default: ResourcePermission
  overrides?: Partial<Record<string, ResourcePermission>>
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
  fallback: ResourcePermission
): ResourcePermission {
  if (!policy) return fallback
  return policy.overrides?.[key] ?? policy.default
}

/** Whether the key carries an explicit override (vs. taking the default). */
export function hasAgentOverride(policy: ExactAgentPolicyLike | undefined, key: string): boolean {
  return policy?.overrides?.[key] !== undefined
}
