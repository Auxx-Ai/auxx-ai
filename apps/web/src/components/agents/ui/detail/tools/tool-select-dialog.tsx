// apps/web/src/components/agents/ui/detail/tools/tool-select-dialog.tsx
'use client'

import type { AgentSurface, CatalogContainerNode, CatalogNode } from '@auxx/lib/agents/client'
import { flattenCatalogToToolsets, matchesToolsetSearch } from '@auxx/lib/agents/client'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { pluralize } from '@auxx/utils/strings'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useToolCatalog } from '~/components/agents/hooks/use-tool-catalog'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { ToolSelectRow, toolCountBadge } from './tool-select-row'

export interface InstalledToolsetEntry {
  slug: string
  enabled: boolean
  source: 'manual' | 'mention' | 'auto_default'
}

interface ToolSelectDialogProps {
  /** Currently installed toolsets — used to render the green check + lock state. */
  installedToolsets: InstalledToolsetEntry[]
  /** App ids that have a bound credential — controls the inline hint in App-detail. */
  boundAppIds: Set<string>
  /** Toggle a single toolset on/off. */
  onToggleToolset: (slug: string, enabled: boolean) => void | Promise<void>
  /** Bulk-toggle multiple toolsets ("Add all tools"). */
  onToggleToolsets: (changes: Array<{ slug: string; enabled: boolean }>) => void | Promise<void>
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * When set + the dialog is opened, jumps straight to the App-detail view
   * for this app id. The Back button still returns to the Apps list.
   */
  initialAppId?: string
  /**
   * Clamp the catalog to one surface (e.g. `'chat'` for chat-kind agents). See
   * plans/chat/v6/chat-tool-availability.md.
   */
  surface?: AgentSurface
}

type ViewMode = 'list' | 'app-detail'
type ListTab = 'all' | 'apps'

type InstalledState = Pick<InstalledToolsetEntry, 'enabled' | 'source'>

/**
 * Multi-view dialog used to add toolsets to an agent. Three surfaces:
 *
 *  - List / All: flat picker grouped into Popular + All tools.
 *  - List / Apps: one row per app, navigates to App-detail on click.
 *  - App-detail: leaves of the selected app with an "Add all tools" button.
 *
 * Clicking a row toggles its enabled flag via `useToolsetMutations` — the
 * dialog stays open so the user can add several toolsets in a row.
 */
export function ToolSelectDialog({
  installedToolsets,
  boundAppIds,
  onToggleToolset,
  onToggleToolsets,
  open,
  onOpenChange,
  initialAppId,
  surface,
}: ToolSelectDialogProps) {
  const { catalog: catalogData, isLoading: catalogIsLoading } = useToolCatalog({ surface })

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [tab, setTab] = useState<ListTab>('all')
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // On open: jump to App-detail when `initialAppId` is provided, else show the list.
  // On close: reset to the default view.
  useEffect(() => {
    if (open) {
      if (initialAppId) {
        setViewMode('app-detail')
        setSelectedAppId(initialAppId)
      } else {
        setViewMode('list')
        setTab('all')
        setSelectedAppId(null)
      }
      setSearch('')
    } else {
      setViewMode('list')
      setTab('all')
      setSelectedAppId(null)
      setSearch('')
    }
    // Only react to `open` flips — `initialAppId` is read at open time.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  }, [open])

  const installedState = useMemo<Map<string, InstalledState>>(() => {
    const map = new Map<string, InstalledState>()
    for (const row of installedToolsets) {
      map.set(row.slug, { enabled: row.enabled, source: row.source })
    }
    return map
  }, [installedToolsets])

  const catalog = catalogData
  const flat = useMemo(() => flattenCatalogToToolsets(catalog), [catalog])

  const selectedApp = useMemo(() => {
    if (!catalog || !selectedAppId) return null
    return catalog.find((root) => root.id === selectedAppId) ?? null
  }, [catalog, selectedAppId])

  function isInstalled(slug: string): boolean {
    const state = installedState.get(slug)
    if (!state) return false
    return state.enabled || state.source === 'mention'
  }

  function sourceOf(slug: string): InstalledState['source'] | undefined {
    return installedState.get(slug)?.source
  }

  const handleToolsetClick = (slug: string) => {
    const installed = isInstalled(slug)
    const source = sourceOf(slug)
    // Locked rows: clicking is a no-op (the row still shows the green check).
    if (installed && source && source !== 'manual') return
    void onToggleToolset(slug, !installed)
  }

  const handleRemove = (slug: string) => {
    const source = sourceOf(slug)
    if (source && source !== 'manual') return
    void onToggleToolset(slug, false)
  }

  const handleOpenApp = (appNode: CatalogContainerNode) => {
    setSelectedAppId(appNode.id)
    setViewMode('app-detail')
    setSearch('')
  }

  const handleBack = () => {
    setViewMode('list')
    setTab('apps')
    setSelectedAppId(null)
    setSearch('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        innerClassName='p-0'
        position='tc'
        size='content'
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          searchInputRef.current?.focus()
        }}>
        <div className='flex flex-col'>
          <DialogNav
            title='Add tools'
            description='Browse the toolset catalog and add tools to this agent.'
            onBack={viewMode === 'app-detail' ? handleBack : undefined}
            crumbs={[
              viewMode === 'app-detail' && selectedApp
                ? {
                    label: selectedApp.label,
                    icon: (
                      <AppIcon
                        iconId={selectedApp.iconId ?? 'package'}
                        color={selectedApp.color}
                        size='xs'
                      />
                    ),
                  }
                : { label: 'Add tools' },
            ]}
          />

          {/* Body — width/height springs between list and app-detail */}
          <DialogNavPages value={viewMode}>
            <DialogNavPage value='list' size='lg'>
              <ListView
                tab={tab}
                onTabChange={setTab}
                search={search}
                onSearchChange={setSearch}
                searchInputRef={searchInputRef}
                catalog={catalog}
                flat={flat}
                isLoading={catalogIsLoading}
                isInstalled={isInstalled}
                sourceOf={sourceOf}
                onToggle={handleToolsetClick}
                onRemove={handleRemove}
                onOpenApp={handleOpenApp}
              />
            </DialogNavPage>

            <DialogNavPage value='app-detail' size='lg'>
              {selectedApp ? (
                <AppDetailView
                  app={selectedApp}
                  isInstalled={isInstalled}
                  sourceOf={sourceOf}
                  onToggle={handleToolsetClick}
                  onRemove={handleRemove}
                  onAddAll={(slugs) => {
                    if (slugs.length === 0) return
                    void onToggleToolsets(slugs.map((slug) => ({ slug, enabled: true })))
                  }}
                  hasBoundAccount={boundAppIds.has(selectedApp.id.replace(/^app:/, ''))}
                />
              ) : (
                <div className='flex items-center justify-center p-8'>
                  <Skeleton className='h-12 w-full max-w-sm rounded-lg' />
                </div>
              )}
            </DialogNavPage>
          </DialogNavPages>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ListViewProps {
  tab: ListTab
  onTabChange: (tab: ListTab) => void
  search: string
  onSearchChange: (q: string) => void
  searchInputRef: React.RefObject<HTMLInputElement>
  catalog: CatalogNode[] | undefined
  flat: ReturnType<typeof flattenCatalogToToolsets>
  isLoading: boolean
  isInstalled: (slug: string) => boolean
  sourceOf: (slug: string) => InstalledState['source'] | undefined
  onToggle: (slug: string) => void
  onRemove: (slug: string) => void
  onOpenApp: (appNode: CatalogContainerNode) => void
}

function ListView({
  tab,
  onTabChange,
  search,
  onSearchChange,
  searchInputRef,
  catalog,
  flat,
  isLoading,
  isInstalled,
  sourceOf,
  onToggle,
  onRemove,
  onOpenApp,
}: ListViewProps) {
  const filteredFlat = useMemo(
    () => flat.filter((e) => matchesToolsetSearch(e, search)),
    [flat, search]
  )

  const popular = filteredFlat.filter((e) => e.isPopular)
  const all = filteredFlat

  const apps = useMemo<CatalogContainerNode[]>(() => {
    if (!catalog) return []
    const roots = catalog.filter((n): n is CatalogContainerNode => n.kind !== 'toolset')
    if (!search.trim()) return roots
    const q = search.trim().toLowerCase()
    return roots.filter((r) => r.label.toLowerCase().includes(q))
  }, [catalog, search])

  return (
    <>
      <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as ListTab)}>
          <TabsList>
            <TabsTrigger value='all'>All</TabsTrigger>
            <TabsTrigger value='apps'>Apps</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className='flex-1 max-w-xs'>
          <InputSearch
            ref={searchInputRef}
            placeholder='Search tools...'
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onClear={() => onSearchChange('')}
          />
        </div>
      </div>

      <ScrollArea className='max-h-[32rem]' scrollbarClassName='w-1!'>
        <div className='py-3 px-3'>
          {isLoading ? (
            <div className='space-y-2'>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className='h-12 w-full rounded-lg' />
              ))}
            </div>
          ) : tab === 'all' ? (
            filteredFlat.length === 0 ? (
              <EmptySearchResult search={search} />
            ) : (
              <div className='space-y-4'>
                {popular.length > 0 && (
                  <Section title='Popular tools'>
                    <div className='grid grid-cols-1 gap-1 sm:grid-cols-2'>
                      {popular.map((entry) => (
                        <ToolSelectRow
                          key={entry.slug}
                          id={entry.slug}
                          iconId={entry.iconId}
                          color={entry.color || null}
                          label={entry.fullLabel}
                          description={entry.description || undefined}
                          badge={toolCountBadge(entry.tools.length) ?? undefined}
                          toolNames={entry.tools.map((t) => t.displayName)}
                          installed={isInstalled(entry.slug)}
                          source={sourceOf(entry.slug)}
                          onSelect={() => onToggle(entry.slug)}
                          onRemove={() => onRemove(entry.slug)}
                        />
                      ))}
                    </div>
                  </Section>
                )}
                {all.length > 0 && (
                  <Section title='All tools'>
                    {all.map((entry) => (
                      <ToolSelectRow
                        key={entry.slug}
                        id={entry.slug}
                        iconId={entry.iconId}
                        color={entry.color || null}
                        label={entry.fullLabel}
                        description={entry.description || undefined}
                        badge={toolCountBadge(entry.tools.length) ?? undefined}
                        toolNames={entry.tools.map((t) => t.displayName)}
                        installed={isInstalled(entry.slug)}
                        source={sourceOf(entry.slug)}
                        onSelect={() => onToggle(entry.slug)}
                        onRemove={() => onRemove(entry.slug)}
                      />
                    ))}
                  </Section>
                )}
              </div>
            )
          ) : apps.length === 0 ? (
            <EmptySearchResult search={search} />
          ) : (
            <div className='space-y-1'>
              {apps.map((appNode) => {
                const counts = countLeaves(appNode, isInstalled)
                return (
                  <ToolSelectRow
                    key={appNode.id}
                    id={appNode.id}
                    iconId={appNode.iconId ?? 'package'}
                    color={appNode.color}
                    label={appNode.label}
                    subtitle={`${counts.installed}/${counts.total} ${pluralize(counts.total, 'tool')} installed`}
                    installed={false}
                    onSelect={() => onOpenApp(appNode)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  )
}

interface AppDetailViewProps {
  app: CatalogContainerNode
  isInstalled: (slug: string) => boolean
  sourceOf: (slug: string) => InstalledState['source'] | undefined
  onToggle: (slug: string) => void
  onRemove: (slug: string) => void
  onAddAll: (slugs: string[]) => void
  /** When false, an inline hint appears prompting the admin to pick a credential. */
  hasBoundAccount: boolean
}

function AppDetailView({
  app,
  isInstalled,
  sourceOf,
  onToggle,
  onRemove,
  onAddAll,
  hasBoundAccount,
}: AppDetailViewProps) {
  const leaves = useMemo(() => flattenCatalogToToolsets([app]), [app])
  const installedCount = leaves.reduce((n, l) => (isInstalled(l.slug) ? n + 1 : n), 0)
  const total = leaves.length
  const allInstalled = installedCount === total && total > 0

  return (
    <>
      <div className='flex items-center justify-between border-b ps-3 pe-2 py-1'>
        <span className='text-xs text-muted-foreground'>
          {installedCount}/{total} {pluralize(total, 'tool')} installed
        </span>
        <Button
          size='sm'
          variant='ghost'
          disabled={allInstalled}
          onClick={() => onAddAll(leaves.map((l) => l.slug))}>
          {allInstalled ? 'All installed' : 'Add all tools'}
        </Button>
      </div>

      <ScrollArea className='max-h-[32rem]' scrollbarClassName='w-1!'>
        <div className='p-3'>
          {leaves.map((entry) => (
            <ToolSelectRow
              key={entry.slug}
              id={entry.slug}
              iconId={entry.iconId}
              color={entry.color || null}
              label={entry.fullLabel}
              description={entry.description || undefined}
              badge={toolCountBadge(entry.tools.length) ?? undefined}
              toolNames={entry.tools.map((t) => t.displayName)}
              installed={isInstalled(entry.slug)}
              source={sourceOf(entry.slug)}
              onSelect={() => onToggle(entry.slug)}
              onRemove={() => onRemove(entry.slug)}
            />
          ))}
        </div>
      </ScrollArea>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className='mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
        {title}
      </h3>
      <div className=''>{children}</div>
    </div>
  )
}

function EmptySearchResult({ search }: { search: string }) {
  return (
    <div className='flex flex-col items-center justify-center py-12 text-center'>
      <p className='text-sm text-muted-foreground'>
        {search.trim() ? `No tools match "${search}".` : 'No tools available.'}
      </p>
    </div>
  )
}

function countLeaves(
  node: CatalogNode,
  isInstalled: (slug: string) => boolean
): { total: number; installed: number } {
  if (node.kind === 'toolset') {
    return { total: 1, installed: isInstalled(node.slug) ? 1 : 0 }
  }
  let total = 0
  let installed = 0
  for (const child of node.children) {
    const sub = countLeaves(child, isInstalled)
    total += sub.total
    installed += sub.installed
  }
  return { total, installed }
}
