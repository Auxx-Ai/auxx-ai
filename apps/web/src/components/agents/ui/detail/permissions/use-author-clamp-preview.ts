// apps/web/src/components/agents/ui/detail/permissions/use-author-clamp-preview.ts
'use client'

import type { AgentAccessLevel, AgentPermissionPolicy } from '@auxx/database'
import {
  AREA_ORDER,
  Level,
  PERMISSION_AREAS,
  type PermissionKey,
} from '@auxx/lib/permissions/client'
import { isAccessManageable } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useResources } from '~/components/resources/hooks'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'
import { AGENT_ACCESS_RANK, resolveAgentLevel } from './agent-access-level'

/** One rung the author clamp would reduce at publish. */
export interface ClampPreviewRow {
  domain: 'area' | 'definition'
  label: string
  from: AgentAccessLevel
  to: AgentAccessLevel
}

export interface AuthorClampPreview {
  /** OWNER/ADMIN — publishing widens legitimately, nothing is reduced. */
  holdsEverything: boolean
  rows: ClampPreviewRow[]
}

const LEVEL_TO_AGENT: Record<Level, AgentAccessLevel> = {
  [Level.None]: 'none',
  [Level.Read]: 'read',
  [Level.Edit]: 'read_write',
  [Level.Full]: 'full',
}

/**
 * The publisher's own rung for an area, from their composed capability keys.
 * Mirrors lib's `areaLevelFromKeys` (which is not client-exported): the highest
 * rung whose keys they hold entirely, stopping at the first gap.
 */
function areaLevel(keys: ReadonlySet<string>, area: (typeof AREA_ORDER)[number]): Level {
  let level = Level.None
  for (const rung of PERMISSION_AREAS[area].rungs) {
    if (rung.keys.every((key: PermissionKey) => keys.has(key))) level = rung.level
    else break
  }
  return level
}

/**
 * A **preview** of the §2.4a author clamp: `min(profilePolicy, your own
 * effective capabilities)`, computed client-side from the same capability blob
 * the rest of the UI gates on.
 *
 * Why show it before publishing at all: §2.4a warns the clamp *will* surface as
 * "my agent can't do what I told it to". A member holding only `agentsManage`
 * can bind the all-`Full` `agent` profile, publish, and get a `Read` agent —
 * so the reduction has to be visible while it can still be acted on (ask an
 * admin to publish), not only after the fact.
 *
 * The server recomputes the clamp authoritatively at publish and returns the
 * exact reductions applied; this preview never replaces that. It covers areas
 * and record types — the two domains the client capability blob can resolve.
 * Per-instance resource reductions are reported by the server after publish.
 */
export function useAuthorClampPreview(policy: AgentPermissionPolicy | null): AuthorClampPreview {
  const { role } = useUser()
  const { capabilities, canViewEntity, canEditEntity, canAdministerDef } = useAccess()
  const { resources } = useResources()

  return useMemo(() => {
    // OWNER short-circuits to all-Full server-side (§0.10); ADMIN still bypasses
    // profile composition until step 10 lands, so neither can be reduced.
    const holdsEverything = role === 'OWNER' || role === 'ADMIN'
    if (!policy || holdsEverything) return { holdsEverything, rows: [] }

    const keys = new Set<string>(capabilities)
    const rows: ClampPreviewRow[] = []

    for (const area of AREA_ORDER) {
      if (PERMISSION_AREAS[area].workerOnly) continue
      const asked = resolveAgentLevel(policy.areas, area, policy.areas.default)
      const held = LEVEL_TO_AGENT[areaLevel(keys, area)]
      if (AGENT_ACCESS_RANK[asked] > AGENT_ACCESS_RANK[held]) {
        rows.push({ domain: 'area', label: PERMISSION_AREAS[area].label, from: asked, to: held })
      }
    }

    for (const resource of resources.filter(isAccessManageable)) {
      const asked = resolveAgentLevel(
        policy.definitions,
        resource.apiSlug,
        policy.definitions.default
      )
      const id = resource.entityDefinitionId
      const held: AgentAccessLevel = canAdministerDef(id)
        ? 'full'
        : canEditEntity(id)
          ? 'read_write'
          : canViewEntity(id)
            ? 'read'
            : 'none'
      if (AGENT_ACCESS_RANK[asked] > AGENT_ACCESS_RANK[held]) {
        rows.push({ domain: 'definition', label: resource.plural, from: asked, to: held })
      }
    }

    return { holdsEverything, rows }
  }, [policy, role, capabilities, resources, canViewEntity, canEditEntity, canAdministerDef])
}
