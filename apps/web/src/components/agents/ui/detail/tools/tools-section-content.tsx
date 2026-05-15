// apps/web/src/components/agents/ui/detail/tools/tools-section-content.tsx
'use client'

import { NATIVE_GROUP_CATALOG, type ToolsetCatalogEntry } from '@auxx/lib/agents/client'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { useCallback, useMemo, useState } from 'react'
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
}

/**
 * Display order for native parent groups. Unknown groups (future app
 * toolsets, or stale slugs without a registered group) sort after these,
 * alphabetically.
 */
const NATIVE_GROUP_ORDER = ['Mail', 'Tasks', 'Entities', 'Knowledge', 'Docs', 'Members']

/**
 * The Tools tab body. Renders the org toolset catalog as collapsible group
 * TreeRows — one per `parentGroup`, each with its toolset rows nested at
 * depth=1. Each row is the atomic unit of control (no per-tool drill-down).
 * Groups start expanded so admins see everything by default.
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

  const { toggleToolset } = useToolsetMutations(agent.id, agent.slug, handleSavingChange)

  const stateBySlug = useMemo<Map<string, ToolsetRowState>>(() => {
    const map = new Map<string, ToolsetRowState>()
    for (const row of agent.toolsets) {
      map.set(row.toolsetSlug, {
        enabled: row.enabled,
        source: row.source,
      })
    }
    return map
  }, [agent.toolsets])

  const grouped = useMemo<Array<[string, ToolsetCatalogEntry[]]>>(() => {
    if (!catalogQuery.data) return []
    const sorted = catalogQuery.data.slice().sort(compareEntries)
    const map = new Map<string, ToolsetCatalogEntry[]>()
    for (const entry of sorted) {
      const group = entry.parentGroup ?? 'Other'
      const list = map.get(group) ?? []
      list.push(entry)
      map.set(group, list)
    }
    return [...map.entries()].sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))
  }, [catalogQuery.data])

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleGroup = useCallback((group: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  if (catalogQuery.isLoading || !catalogQuery.data) {
    return (
      <div className='px-3 pb-6 space-y-3'>
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-12 w-full' />
      </div>
    )
  }

  return (
    <div className='flex flex-col pe-3'>
      {grouped.map(([group, entries]) => {
        const meta = NATIVE_GROUP_CATALOG[group]
        const isOpen = !collapsed.has(group)
        const enabledCount = entries.reduce(
          (acc, e) => acc + (stateBySlug.get(e.slug)?.enabled ? 1 : 0),
          0
        )
        return (
          <TreeRow
            key={group}
            icon={
              meta ? <EntityIcon iconId={meta.iconId} color={meta.color} size='sm' /> : undefined
            }
            title={group}
            expandable
            isOpen={isOpen}
            onToggleOpen={() => toggleGroup(group)}
            actions={
              <span className='text-xs text-muted-foreground'>
                {enabledCount}/{entries.length}
              </span>
            }>
            {entries.map((entry) => {
              const state = stateBySlug.get(entry.slug) ?? {
                enabled: false,
                source: 'manual' as const,
              }
              return (
                <ToolsetRow
                  key={entry.slug}
                  depth={1}
                  slug={entry.slug}
                  label={entry.shortLabel ?? entry.label}
                  iconId={entry.iconId ?? 'wrench'}
                  color={entry.color ?? 'gray'}
                  toolCount={entry.tools.length}
                  enabled={state.enabled}
                  source={state.source}
                  onToolsetToggle={toggleToolset}
                />
              )
            })}
          </TreeRow>
        )
      })}
    </div>
  )
}

function groupRank(group: string): number {
  const i = NATIVE_GROUP_ORDER.indexOf(group)
  return i === -1 ? NATIVE_GROUP_ORDER.length : i
}

/**
 * Within a group, defaults sort first, then native before app, then by short
 * label alphabetically.
 */
function compareEntries(a: ToolsetCatalogEntry, b: ToolsetCatalogEntry): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
  if (a.group !== b.group) return a.group === 'native' ? -1 : 1
  const aLabel = a.shortLabel ?? a.label
  const bLabel = b.shortLabel ?? b.label
  return aLabel.localeCompare(bLabel)
}
