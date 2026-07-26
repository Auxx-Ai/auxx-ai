// apps/web/src/components/permissions/hooks/use-agent-policy-clamp.ts
'use client'

import type { AgentAccessLevel } from '@auxx/database'
import {
  type Area,
  Level,
  PERMISSION_AREAS,
  type PermissionKey,
} from '@auxx/lib/permissions/client'
import { useMemo } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { AGENT_LEVEL_RANK } from '../ui/agent-policy-copy'
import type { NormalizedAgentPolicy } from './use-agent-policy'

/**
 * A *preview* of the §2.4a author clamp — `min(profilePolicy, publisher's own
 * effective capabilities)`, evaluated against the viewer.
 *
 * Why it exists: publish silently producing a weaker agent than the profile
 * describes is the failure mode §2.4a calls out by name ("my agent can't do what
 * I told it to"). Showing the reduction while the policy is being authored is
 * cheaper than discovering it after a publish.
 *
 * Why it is only a preview: the authoritative clamp runs server-side at publish,
 * against the publisher's freshly composed capabilities, and is recorded on
 * `AgentVersion.permissionPolicy.clamp`. This mirror reads the client capability
 * snapshot, so it is degrade-only — it can lag, and it deliberately covers just
 * the two keyspaces the client can answer exactly (areas and entity
 * definitions). It is never a substitute for the publish-time disclosure.
 */

/** One reduction the clamp would apply, ready to render. */
export interface AgentPolicyClampPreviewEntry {
  /** Mirrors `AgentPolicyClampEntry.domain` (the resource domain is publish-side). */
  domain: 'area' | 'definition'
  /** Area slug or entity `apiSlug` — the key the published clamp entry would carry. */
  key: string
  /** Human label for the sentence. */
  label: string
  /** The rung the profile asks for. */
  from: AgentAccessLevel
  /** The rung the viewer's own authority permits. */
  to: AgentAccessLevel
}

/** One entity definition the preview should check. */
export interface ClampDefinitionRef {
  apiSlug: string
  entityDefinitionId: string
  label: string
}

/** `Level` → the agent ladder. The inverse of the §2.3 mapping table. */
function toAgentLevel(level: Level): AgentAccessLevel {
  if (level >= Level.Full) return 'full'
  if (level >= Level.Edit) return 'read_write'
  if (level >= Level.Read) return 'read'
  return 'none'
}

/**
 * Recover an area's rung from a flat capability key set — the inverse of
 * `expandLevelsToKeys`. A rung counts as held only when every key it introduces
 * is present, and the ladder stops at the first gap, so a stray higher key can
 * never invent authority the composer did not grant.
 */
function areaLevelFromKeys(area: Area, held: ReadonlySet<string>): Level {
  let level = Level.None
  for (const rung of PERMISSION_AREAS[area].rungs) {
    if (!rung.keys.every((key: PermissionKey) => held.has(key))) break
    level = rung.level
  }
  return level
}

/** Look one key up in an exact policy — override wins, else the collection default. */
function lookup(
  policy: { default: AgentAccessLevel; overrides: Partial<Record<string, AgentAccessLevel>> },
  key: string
): AgentAccessLevel {
  return policy.overrides[key] ?? policy.default
}

/**
 * Compute what publishing this policy *as the current user* would reduce.
 *
 * @param policy - The draft policy being edited.
 * @param areas - The area slugs the editor exposes (the same list the grid renders).
 * @param definitions - The definitions the editor exposes, with their def ids.
 */
export function useAgentPolicyClamp(
  policy: NormalizedAgentPolicy,
  areas: readonly Area[],
  definitions: readonly ClampDefinitionRef[]
): { entries: AgentPolicyClampPreviewEntry[]; isLoading: boolean } {
  const { capabilities, canViewEntity, canEditEntity, canAdministerDef, isLoading } = useAccess()

  const held = useMemo(() => new Set<string>(capabilities), [capabilities])

  const entries = useMemo(() => {
    const reductions: AgentPolicyClampPreviewEntry[] = []

    for (const area of areas) {
      const asked = lookup(policy.areas, area)
      const holds = toAgentLevel(areaLevelFromKeys(area, held))
      if (AGENT_LEVEL_RANK[asked] > AGENT_LEVEL_RANK[holds]) {
        reductions.push({
          domain: 'area',
          key: area,
          label: PERMISSION_AREAS[area].label,
          from: asked,
          to: holds,
        })
      }
    }

    for (const def of definitions) {
      const asked = lookup(policy.definitions, def.apiSlug)
      const holds: AgentAccessLevel = canAdministerDef(def.entityDefinitionId)
        ? 'full'
        : canEditEntity(def.entityDefinitionId)
          ? 'read_write'
          : canViewEntity(def.entityDefinitionId)
            ? 'read'
            : 'none'
      if (AGENT_LEVEL_RANK[asked] > AGENT_LEVEL_RANK[holds]) {
        reductions.push({
          domain: 'definition',
          key: def.apiSlug,
          label: def.label,
          from: asked,
          to: holds,
        })
      }
    }

    return reductions
  }, [policy, areas, definitions, held, canViewEntity, canEditEntity, canAdministerDef])

  return { entries, isLoading }
}
