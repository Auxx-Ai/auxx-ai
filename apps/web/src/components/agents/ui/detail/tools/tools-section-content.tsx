// apps/web/src/components/agents/ui/detail/tools/tools-section-content.tsx
'use client'

import type { CatalogNode } from '@auxx/lib/agents/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useCallback, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'
import { CatalogNodeRow, collectToggleable, type ToolsetRowState } from './catalog-node-row'
import { useToolsetMutations } from './use-toolset-mutations'

interface ToolsSectionContentProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
}

/**
 * The Tools tab body. Renders the org catalog tree as a recursive `TreeRow`:
 * App → (optional Sub-group) → Toolset. Switches cascade — toggling an app
 * row toggles every toolset under it (respecting mention locks); same for
 * sub-group rows. See `plans/kopilot/agents/tools/recursive-catalog-node.md`.
 */
export function ToolsSectionContent({ agent, onAutosaveChange }: ToolsSectionContentProps) {
  const catalogQuery = api.agentToolset.list.useQuery(undefined, {
    staleTime: 60_000,
  })

  const handleSavingChange = useCallback(
    (saving: boolean) => {
      onAutosaveChange?.(saving ? { kind: 'saving' } : { kind: 'saved', at: Date.now() })
    },
    [onAutosaveChange]
  )

  const { toggleToolset, toggleToolsets } = useToolsetMutations(
    agent.id,
    agent.slug,
    handleSavingChange
  )

  const stateBySlug = useMemo<Map<string, ToolsetRowState>>(() => {
    const map = new Map<string, ToolsetRowState>()
    for (const row of agent.toolsets) {
      map.set(row.slug, { enabled: row.enabled, source: row.source })
    }
    return map
  }, [agent.toolsets])

  // One Set for every container id in the tree; presence = collapsed.
  // Defaults to empty (everything expanded — matches the pre-refactor UX).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onCascadeToggle = useCallback(
    (node: CatalogNode, nextEnabled: boolean) => {
      const targets = collectToggleable(node, stateBySlug, nextEnabled)
      if (targets.length > 0) void toggleToolsets(targets)
    },
    [stateBySlug, toggleToolsets]
  )

  if (catalogQuery.isLoading || !catalogQuery.data) {
    return (
      <div className='flex flex-col pe-4'>
        {[0, 1, 2].map((i) => (
          <div key={i} className='ps-2'>
            <div className='flex items-center gap-2 px-1 h-9'>
              <Skeleton className='size-5 rounded-md' />
              <Skeleton className='h-4 w-32' />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className='flex flex-col pe-4'>
      {catalogQuery.data.map((root) => (
        <CatalogNodeRow
          key={root.id}
          node={root}
          depth={0}
          inheritedIconId={root.iconId ?? 'package'}
          inheritedColor={root.color}
          stateBySlug={stateBySlug}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onCascadeToggle={onCascadeToggle}
          onLeafToggle={toggleToolset}
        />
      ))}
    </div>
  )
}
