// apps/web/src/components/agents/ui/detail/tools/tools-section.tsx
'use client'

import type { CatalogNode } from '@auxx/lib/agents/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Lock, Plus, Wrench } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useToolCatalog } from '~/components/agents/hooks/use-tool-catalog'
import { useAppsContext } from '~/components/apps/providers/apps-context'
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
import { ToolSelectDialog } from './tool-select-dialog'
import { useToolsetMutations } from './use-toolset-mutations'

interface ToolsSectionProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
  /** Jump to another builder tab — used by the Tools ⇄ Permissions cross-link. */
  onNavigate?: (tab: string) => void
}

/**
 * Tools section — owns the `<Section>` shell (with the "Add tools" action), the
 * `ToolSelectDialog` catalog browser, and the installed-tools tree. Renders only
 * the toolsets currently installed on the agent as a pruned App → SubGroup →
 * Toolset tree. See `plans/kopilot/agents/tools/tool-select-dialog.md`.
 */
export function ToolsSection({ agent, onAutosaveChange, onNavigate }: ToolsSectionProps) {
  const { catalog, isLoading: catalogIsLoading } = useToolCatalog({
    surface: agent.kind === 'chat' ? 'chat' : undefined,
  })

  const handleSavingChange = useCallback(
    (saving: boolean) => {
      onAutosaveChange?.(saving ? { kind: 'saving' } : { kind: 'saved', at: Date.now() })
    },
    [onAutosaveChange]
  )

  const { toggleToolset, toggleToolsets, updateToolset, toggleTool } = useToolsetMutations(
    agent.id,
    agent.slug,
    handleSavingChange
  )

  // "Add tools" dialog state. `pendingAppId` pre-selects an app when the user
  // clicks "Add" on a top-level app row instead of the section action.
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingAppId, setPendingAppId] = useState<string | null>(null)
  const boundAppIds = useMemo(
    () => new Set(Object.keys(agent.appAccounts ?? {})),
    [agent.appAccounts]
  )

  const stateBySlug = useMemo<Map<string, ToolsetRowState>>(() => {
    const map = new Map<string, ToolsetRowState>()
    for (const row of agent.toolsets) {
      map.set(row.slug, { enabled: row.enabled, source: row.source, mentions: row.mentions })
    }
    return map
  }, [agent.toolsets])

  // Per-toolset allow-lists, so MCP server rows can show an enabled-tool
  // count (`N of M`) instead of a toolset count. Presence in the map means
  // "the entry carries a list" — an empty list counts as 0 enabled; an entry
  // without a list (legacy pass-all) stays out of the map.
  const enabledToolsBySlug = useMemo<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>()
    for (const row of agent.toolsets) {
      const enabled = (row.config as { enabledTools?: string[] })?.enabledTools
      if (Array.isArray(enabled)) map.set(row.slug, new Set(enabled))
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
      if (n.kind === 'toolset' || n.kind === 'tool') return
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

  // MCP toolset slugs whose org-wide connection needs reconnecting — drives the tree status dot.
  const { mcpServers } = useAppsContext()
  const mcpReconnectSlugs = useMemo(
    () => new Set(mcpServers.filter((s) => s.needsReconnect).map((s) => s.toolsetSlug)),
    [mcpServers]
  )

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
        // Mention-locked rows can't be removed — the prompt/procedure pins them.
        if (state?.mentions?.length) continue
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

  return (
    <>
      <Section
        title='Tools'
        icon={<Wrench className='size-4' />}
        className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
        initialOpen
        collapsible={false}
        actions={
          <Button
            size='xs'
            variant='ghost'
            onClick={() => {
              setPendingAppId(null)
              setDialogOpen(true)
            }}>
            <Plus />
            Add tools
          </Button>
        }>
        {catalogIsLoading ? (
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
        ) : installedTree.length === 0 ? (
          <div className='px-3 py-2'>
            <EmptySection
              icon={<Wrench className='size-5' />}
              title='No tools yet'
              description='Add tools to give this agent capabilities.'
            />
          </div>
        ) : (
          <div className='flex flex-col ps-2 pe-4'>
            {installedTree.map((root) => (
              <CatalogNodeRow
                key={root.id}
                node={root}
                depth={0}
                inheritedIconId={root.iconId ?? 'package'}
                inheritedColor={root.color}
                stateBySlug={stateBySlug}
                enabledToolsBySlug={enabledToolsBySlug}
                restrictionCountBySlug={restrictionCountBySlug}
                collapsed={collapsed}
                onToggleCollapsed={toggleCollapsed}
                onRemove={handleRemove}
                onToggleTool={toggleTool}
                onAddToApp={(appId) => {
                  setPendingAppId(appId)
                  setDialogOpen(true)
                }}
                onOpenAccountPicker={setAccountPickerAppId}
                boundCredIdByApp={boundCredIdByApp}
                warnNotExternalSafe={agent.kind === 'chat'}
                mcpReconnectSlugs={mcpReconnectSlugs}
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
        )}
        {/* Two separate keys (plan 19 §2.4): this list decides which tools the
            model may CALL; the Permissions tab decides what those calls may DO.
            Both are published on the version, and both are required. */}
        <div className='px-3 pt-3 text-xs text-muted-foreground'>
          Enabling a tool here does not grant access. Every call is still checked against the
          agent&apos;s permission policy, so a tool can never exceed it — and permission without a
          tool does nothing: a record type set to <strong>Full</strong> authorizes schema
          administration, but no native schema-mutation tool exists yet, so nothing in this list can
          use that rung today.
          {onNavigate && (
            <Button
              variant='ghost'
              size='xs'
              className='ms-1 -my-1'
              onClick={() => onNavigate('permissions')}>
              <Lock />
              Permissions
            </Button>
          )}
        </div>
      </Section>
      <ToolSelectDialog
        installedToolsets={agent.toolsets}
        boundAppIds={boundAppIds}
        surface={agent.kind === 'chat' ? 'chat' : undefined}
        onToggleToolset={toggleToolset}
        onToggleToolsets={toggleToolsets}
        onUpdateToolset={updateToolset}
        onToggleTool={toggleTool}
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next)
          if (!next) setPendingAppId(null)
        }}
        initialAppId={pendingAppId ?? undefined}
      />
    </>
  )
}
