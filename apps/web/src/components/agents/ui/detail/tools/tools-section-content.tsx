// apps/web/src/components/agents/ui/detail/tools/tools-section-content.tsx
'use client'

import type { CatalogNode } from '@auxx/lib/agents/client'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Wrench } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useToolCatalog } from '~/components/agents/hooks/use-tool-catalog'
import { AppAccountDialog } from '~/components/apps/ui/app-account-dialog'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'
import { useToolMeta } from '../bindings/hooks/use-tool-meta'
import {
  CatalogNodeRow,
  collectLeaves,
  pruneToInstalled,
  type ToolsetRowState,
} from './catalog-node-row'
import { useToolsetMutations } from './use-toolset-mutations'

interface ToolsSectionContentProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
  /** Invoked when a top-level app row's "Add" button is clicked. */
  onAddToApp?: (appId: string) => void
}

/**
 * Tools tab body — renders only the toolsets currently installed on the
 * agent, as a pruned App → SubGroup → Toolset tree. The catalog browser and
 * the "Add tools" trigger live one level up in `ToolsSection`
 * (`agent-detail-tabs.tsx`); this component intentionally has no header so
 * the action sits inside `<Section actions>`. See
 * `plans/kopilot/agents/tools/tool-select-dialog.md`.
 */
export function ToolsSectionContent({
  agent,
  onAutosaveChange,
  onAddToApp,
}: ToolsSectionContentProps) {
  const { catalog, isLoading: catalogIsLoading } = useToolCatalog({
    surface: agent.kind === 'chat' ? 'chat' : undefined,
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

  // Read-only restriction counts per toolset slug, so the Tools tree can show a
  // lock badge next to toolsets that carry restrictions. Derived from
  // `agent.toolRestrictions` (keyed by registered name) via the tool-meta
  // lookup. Managing the rules still lives in the Restrictions section.
  const { byRegisteredName } = useToolMeta(agent)
  const restrictionCountBySlug = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>()
    for (const [registeredName, perTool] of Object.entries(agent.toolRestrictions ?? {})) {
      const argCount = Object.keys(perTool).length
      if (argCount === 0) continue
      const slug = byRegisteredName.get(registeredName)?.toolsetSlug
      if (!slug) continue
      map.set(slug, (map.get(slug) ?? 0) + argCount)
    }
    return map
  }, [agent.toolRestrictions, byRegisteredName])

  const installedTree = useMemo(
    () => pruneToInstalled(catalog, stateBySlug),
    [catalog, stateBySlug]
  )

  // Default = every container id collapsed. Derived synchronously from
  // `installedTree` so the first render is already in the closed state — no
  // open/close flash. Once the user toggles a row, `collapsed` becomes their
  // explicit set and stays that way.
  const defaultCollapsed = useMemo(() => {
    const ids = new Set<string>()
    const walk = (n: CatalogNode) => {
      if (n.kind === 'toolset') return
      ids.add(n.id)
      n.children.forEach(walk)
    }
    installedTree.forEach(walk)
    return ids
  }, [installedTree])

  const [collapsedOverride, setCollapsedOverride] = useState<Set<string> | null>(null)
  const collapsed = collapsedOverride ?? defaultCollapsed

  // Map each appId → bound credId so child rows render the right badge
  // without re-reading the agent on every row. Derived from
  // `agent.appAccounts`.
  const boundCredIdByApp = useMemo<Record<string, string | undefined>>(() => {
    const map: Record<string, string | undefined> = {}
    for (const [appId, entry] of Object.entries(agent.appAccounts ?? {})) {
      map[appId] = entry?.credId
    }
    return map
  }, [agent.appAccounts])

  const [accountPickerAppId, setAccountPickerAppId] = useState<string | null>(null)

  const utils = api.useUtils()
  const updateAgent = api.agent.update.useMutation()

  const bindAgentCredId = useCallback(
    async (appId: string, credId: string) => {
      const previous = utils.agent.getById.getData({ agentId: agent.slug })
      utils.agent.getById.setData({ agentId: agent.slug }, (old) =>
        old ? { ...old, appAccounts: { ...old.appAccounts, [appId]: { credId } } } : old
      )
      try {
        await updateAgent.mutateAsync({
          agentId: agent.id,
          appAccounts: { [appId]: { credId } },
        })
      } catch (err) {
        utils.agent.getById.setData({ agentId: agent.slug }, previous)
        toastError({
          title: 'Failed to set account',
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    },
    [agent.id, agent.slug, utils, updateAgent]
  )

  const toggleCollapsed = useCallback(
    (id: string) => {
      setCollapsedOverride((prev) => {
        const base = prev ?? defaultCollapsed
        const next = new Set(base)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [defaultCollapsed]
  )

  const handleRemove = useCallback(
    (node: CatalogNode) => {
      const changes: Array<{ slug: string; enabled: boolean }> = []
      for (const leaf of collectLeaves(node)) {
        const state = stateBySlug.get(leaf.slug)
        if (state?.source === 'mention') continue
        if (!state?.enabled) continue
        changes.push({ slug: leaf.slug, enabled: false })
      }
      if (changes.length === 0) return
      if (changes.length === 1) {
        void toggleToolset(changes[0].slug, false)
        return
      }
      void toggleToolsets(changes)
    },
    [stateBySlug, toggleToolset, toggleToolsets]
  )

  if (catalogIsLoading) {
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

  if (installedTree.length === 0) {
    return (
      <div className='px-3 py-2'>
        <EmptySection
          icon={<Wrench className='size-5' />}
          title='No tools yet'
          description='Add tools to give this agent capabilities.'
        />
      </div>
    )
  }

  return (
    <div className='flex flex-col pe-4'>
      {installedTree.map((root) => (
        <CatalogNodeRow
          key={root.id}
          node={root}
          depth={0}
          inheritedIconId={root.iconId ?? 'package'}
          inheritedColor={root.color}
          stateBySlug={stateBySlug}
          restrictionCountBySlug={restrictionCountBySlug}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onRemove={handleRemove}
          onAddToApp={onAddToApp}
          onOpenAccountPicker={setAccountPickerAppId}
          boundCredIdByApp={boundCredIdByApp}
          warnNotExternalSafe={agent.kind === 'chat'}
        />
      ))}
      <AppAccountDialog
        appId={accountPickerAppId}
        value={accountPickerAppId ? boundCredIdByApp[accountPickerAppId] : undefined}
        onSubmit={(next) => {
          if (accountPickerAppId && typeof next === 'string') {
            void bindAgentCredId(accountPickerAppId, next)
          }
        }}
        open={accountPickerAppId !== null}
        onOpenChange={(open) => {
          if (!open) setAccountPickerAppId(null)
        }}
      />
    </div>
  )
}
