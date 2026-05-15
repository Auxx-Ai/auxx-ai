// apps/web/src/components/agents/ui/detail/tools/tools-section-content.tsx
'use client'

import type { ToolsetCatalogEntry } from '@auxx/lib/agents/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'
import { ToolsetRow } from './toolset-row'
import { useToolsetMutations } from './use-toolset-mutations'

interface ToolsSectionContentProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
}

type ToolsetRowState = {
  enabled: boolean
  source: 'manual' | 'mention' | 'auto_default'
  disabledTools: string[]
}

/**
 * The Tools tab body. Renders the org toolset catalog as a flat outline of
 * `TreeRow`s — one row per toolset, per-tool checkboxes inline beneath when
 * the toolset is enabled. Default toolsets sort to the top.
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

  const { toggleToolset, toggleTool } = useToolsetMutations(
    agent.id,
    agent.slug,
    handleSavingChange
  )

  const stateBySlug = useMemo<Map<string, ToolsetRowState>>(() => {
    const map = new Map<string, ToolsetRowState>()
    for (const row of agent.toolsets) {
      map.set(row.toolsetSlug, {
        enabled: row.enabled,
        source: row.source,
        disabledTools: (row.config?.disabledTools as string[]) ?? [],
      })
    }
    return map
  }, [agent.toolsets])

  if (catalogQuery.isLoading || !catalogQuery.data) {
    return (
      <div className='px-3 pb-6 space-y-3'>
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-12 w-full' />
      </div>
    )
  }

  const sorted = catalogQuery.data.slice().sort(compareEntries)

  const renderRow = (entry: ToolsetCatalogEntry) => {
    const state = stateBySlug.get(entry.slug) ?? {
      enabled: false,
      source: 'manual' as const,
      disabledTools: [],
    }
    return (
      <ToolsetRow
        key={entry.slug}
        slug={entry.slug}
        label={entry.label}
        tools={entry.tools}
        enabled={state.enabled}
        source={state.source}
        disabledTools={state.disabledTools}
        onToolsetToggle={toggleToolset}
        onToolToggle={toggleTool}
      />
    )
  }

  return <div className='flex flex-col pe-3'>{sorted.map(renderRow)}</div>
}

function compareEntries(a: ToolsetCatalogEntry, b: ToolsetCatalogEntry): number {
  const groupRank = (e: ToolsetCatalogEntry) => (e.isDefault ? 0 : e.group === 'native' ? 1 : 2)
  return groupRank(a) - groupRank(b) || a.label.localeCompare(b.label)
}
