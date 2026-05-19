// apps/web/src/app/(protected)/app/settings/kopilot/_components/toolsets-section.tsx
'use client'

import type { CatalogNode } from '@auxx/lib/agents/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Plus, Wrench } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  CatalogNodeRow,
  collectLeaves,
  pruneToInstalled,
  type ToolsetRowState,
} from '~/components/agents/ui/detail/tools/catalog-node-row'
import { ToolSelectDialog } from '~/components/agents/ui/detail/tools/tool-select-dialog'
import { AppAccountDialog } from '~/components/apps/ui/app-account-dialog'
import { api } from '~/trpc/react'
import { useMasterKopilotToolsets } from './use-master-kopilot-toolsets'

/**
 * Unified Toolsets section for Kopilot. Mirrors the agent tools surface:
 * renders only installed toolsets as a pruned App → SubGroup → Toolset tree,
 * with a "+ Add tools" trigger that opens the catalog browser dialog.
 */
export function ToolsetsSection() {
  const catalogQuery = api.agentToolset.list.useQuery(undefined, { staleTime: 60_000 })
  const catalog = catalogQuery.data ?? []
  const tools = useMasterKopilotToolsets(catalog)

  const stateBySlug = useMemo<Map<string, ToolsetRowState>>(() => {
    const map = new Map<string, ToolsetRowState>()
    for (const row of tools.effective) {
      map.set(row.slug, { enabled: row.enabled, source: row.source })
    }
    return map
  }, [tools.effective])

  const boundCredIdByApp = useMemo<Record<string, string | undefined>>(() => {
    const map: Record<string, string | undefined> = {}
    for (const [appId, entry] of Object.entries(tools.appAccounts)) {
      map[appId] = entry?.credId
    }
    return map
  }, [tools.appAccounts])

  const boundAppIds = useMemo(
    () =>
      new Set(
        Object.entries(tools.appAccounts)
          .filter(([, entry]) => !!entry?.credId)
          .map(([appId]) => appId)
      ),
    [tools.appAccounts]
  )

  const installedTree = useMemo(
    () => pruneToInstalled(catalog, stateBySlug),
    [catalog, stateBySlug]
  )

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

  const [accountPickerAppId, setAccountPickerAppId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingAppId, setPendingAppId] = useState<string | null>(null)

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
      if (changes.length === 1) {
        void tools.toggleToolset(changes[0]!.slug, false)
      } else {
        void tools.toggleToolsets(changes)
      }
    },
    [stateBySlug, tools]
  )

  return (
    <section className='space-y-3'>
      <div className='flex items-start justify-between gap-3'>
        <SectionHeading />
        <Button
          size='sm'
          variant='ghost'
          onClick={() => {
            setPendingAppId(null)
            setDialogOpen(true)
          }}>
          <Plus />
          Add tools
        </Button>
      </div>
      <div className='flex flex-col pe-4'>
        {catalogQuery.isLoading ? (
          <div className='flex flex-col gap-1'>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className='h-9 w-full' />
            ))}
          </div>
        ) : installedTree.length === 0 ? (
          <EmptySection
            icon={<Wrench className='size-5' />}
            title='No tools yet'
            description='Add tools to give Kopilot capabilities.'
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
        installedToolsets={tools.effective}
        boundAppIds={boundAppIds}
        onToggleToolset={tools.toggleToolset}
        onToggleToolsets={tools.toggleToolsets}
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
        allowPersonal={false}
        onSubmit={(next) => {
          if (accountPickerAppId && typeof next === 'string') {
            void tools.bindAppAccount(accountPickerAppId, next)
          }
        }}
        open={accountPickerAppId !== null}
        onOpenChange={(open) => {
          if (!open) setAccountPickerAppId(null)
        }}
      />
    </section>
  )
}

function SectionHeading() {
  return (
    <div className='space-y-1'>
      <h2 className='text-base font-semibold tracking-tight text-foreground'>Toolsets</h2>
      <p className='text-sm text-muted-foreground'>
        Native Auxx tools available to Kopilot. App-backed tools require a workspace credential pin.
      </p>
    </div>
  )
}
