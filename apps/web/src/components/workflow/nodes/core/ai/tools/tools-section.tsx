// apps/web/src/components/workflow/nodes/core/ai/tools/tools-section.tsx
'use client'

import type { CatalogNode, ToolsetEntry } from '@auxx/lib/agents/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Plus, Wrench } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useToolCatalog } from '~/components/agents/hooks/use-tool-catalog'
import {
  CatalogNodeRow,
  collectLeaves,
  pruneToInstalled,
  type ToolsetRowState,
} from '~/components/agents/ui/detail/tools/catalog-node-row'
import { ToolSelectDialog } from '~/components/agents/ui/detail/tools/tool-select-dialog'
import { AppAccountDialog } from '~/components/apps/ui/app-account-dialog'
import Section from '~/components/workflow/ui/section'
import type { AiNodeData } from '../types'

interface ToolsSectionProps {
  data: AiNodeData
  setData: (data: AiNodeData) => void
}

/**
 * AI-node Tools section. Third caller of the agent framework's
 * `ToolSelectDialog` (after `agent-detail-tabs.tsx` and the Kopilot
 * `toolsets-section.tsx`). Reads/writes the flat `nodeData.toolsets` +
 * `nodeData.appAccounts` fields — no mutations, the workflow editor
 * autosaves the node config when `setData` changes the panel state.
 *
 * See `plans/workflow/ai/phase-3-frontend-picker-migration.md`.
 */
export function ToolsSection({ data, setData }: ToolsSectionProps) {
  const { catalog, isLoading: catalogIsLoading } = useToolCatalog()

  const toolsets = data.toolsets ?? []
  const appAccounts = data.appAccounts ?? {}
  const toolsEnabled = data.toolsEnabled ?? false

  const stateBySlug = useMemo<Map<string, ToolsetRowState>>(() => {
    const map = new Map<string, ToolsetRowState>()
    for (const row of toolsets) {
      map.set(row.slug, { enabled: row.enabled, source: row.source })
    }
    return map
  }, [toolsets])

  const boundCredIdByApp = useMemo<Record<string, string | undefined>>(() => {
    const map: Record<string, string | undefined> = {}
    for (const [appId, entry] of Object.entries(appAccounts)) {
      map[appId] = entry?.credId
    }
    return map
  }, [appAccounts])

  const boundAppIds = useMemo(
    () =>
      new Set(
        Object.entries(appAccounts)
          .filter(([, entry]) => !!entry?.credId)
          .map(([appId]) => appId)
      ),
    [appAccounts]
  )

  const installedTree = useMemo(
    () => pruneToInstalled(catalog, stateBySlug),
    [catalog, stateBySlug]
  )

  const defaultCollapsed = useMemo(() => {
    const ids = new Set<string>()
    const walk = (n: CatalogNode) => {
      if (n.kind === 'toolset' || n.kind === 'tool') return
      ids.add(n.id)
      n.children.forEach(walk)
    }
    installedTree.forEach(walk)
    return ids
  }, [installedTree])

  const [collapsedOverride, setCollapsedOverride] = useState<Set<string> | null>(null)
  const collapsed = collapsedOverride ?? defaultCollapsed

  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingAppId, setPendingAppId] = useState<string | null>(null)
  const [accountPickerAppId, setAccountPickerAppId] = useState<string | null>(null)

  const applyToolsetChange = useCallback(
    (current: ToolsetEntry[], slug: string, enabled: boolean): ToolsetEntry[] => {
      const idx = current.findIndex((t) => t.slug === slug)
      if (idx >= 0) {
        const next = [...current]
        const existing = next[idx]
        if (!existing) return current
        next[idx] = { ...existing, enabled }
        return next
      }
      return [
        ...current,
        {
          slug,
          enabled,
          source: 'manual',
          config: {},
        },
      ]
    },
    []
  )

  const toggleToolset = useCallback(
    (slug: string, enabled: boolean) => {
      setData({ ...data, toolsets: applyToolsetChange(toolsets, slug, enabled) })
    },
    [data, setData, toolsets, applyToolsetChange]
  )

  const toggleToolsets = useCallback(
    (changes: Array<{ slug: string; enabled: boolean }>) => {
      if (changes.length === 0) return
      let next = toolsets
      for (const { slug, enabled } of changes) {
        next = applyToolsetChange(next, slug, enabled)
      }
      setData({ ...data, toolsets: next })
    },
    [data, setData, toolsets, applyToolsetChange]
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
        if (!state?.enabled) continue
        changes.push({ slug: leaf.slug, enabled: false })
      }
      if (changes.length === 0) return
      toggleToolsets(changes)
    },
    [stateBySlug, toggleToolsets]
  )

  const bindAppAccount = useCallback(
    (appId: string, credId: string) => {
      setData({
        ...data,
        appAccounts: { ...appAccounts, [appId]: { credId } },
      })
    },
    [data, setData, appAccounts]
  )

  return (
    <Section
      title='Tools'
      description='Allow AI to call installed app tools and built-in Auxx tools'
      showEnable
      onEnableChange={(enabled) => setData({ ...data, toolsEnabled: enabled })}
      enabled={toolsEnabled}
      initialOpen={toolsEnabled}
      actions={
        toolsEnabled && (
          <Button
            size='xs'
            variant='ghost'
            onClick={(e) => {
              // Section's header toggles open/close on click — stop the action
              // button from bubbling so we don't collapse the section.
              e.stopPropagation()
              setPendingAppId(null)
              setDialogOpen(true)
            }}>
            <Plus />
            Add tools
          </Button>
        )
      }>
      <div className='flex flex-col'>
        {catalogIsLoading ? (
          <div className='flex flex-col gap-1'>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className='h-9 w-full' />
            ))}
          </div>
        ) : installedTree.length === 0 ? (
          <EmptySection
            icon={<Wrench className='size-5' />}
            title='No tools yet'
            description='Add tools to let this AI node call apps and built-in functions.'
          />
        ) : (
          installedTree.map((root) => (
            <CatalogNodeRow
              key={root.id}
              node={root}
              depth={0}
              inheritedIconId={root.iconId ?? 'package'}
              inheritedColor={root.color}
              stateBySlug={stateBySlug}
              collapsed={collapsed}
              onToggleCollapsed={toggleCollapsed}
              onRemove={handleRemove}
              onAddToApp={(appId) => {
                setPendingAppId(appId)
                setDialogOpen(true)
              }}
              onOpenAccountPicker={setAccountPickerAppId}
              boundCredIdByApp={boundCredIdByApp}
            />
          ))
        )}
      </div>
      <ToolSelectDialog
        installedToolsets={toolsets}
        boundAppIds={boundAppIds}
        onToggleToolset={toggleToolset}
        onToggleToolsets={toggleToolsets}
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next)
          if (!next) setPendingAppId(null)
        }}
        initialAppId={pendingAppId ?? undefined}
      />
      <AppAccountDialog
        appId={accountPickerAppId}
        value={accountPickerAppId ? boundCredIdByApp[accountPickerAppId] : undefined}
        onSubmit={(next) => {
          if (accountPickerAppId && typeof next === 'string') {
            bindAppAccount(accountPickerAppId, next)
          }
        }}
        open={accountPickerAppId !== null}
        onOpenChange={(open) => {
          if (!open) setAccountPickerAppId(null)
        }}
      />
    </Section>
  )
}
