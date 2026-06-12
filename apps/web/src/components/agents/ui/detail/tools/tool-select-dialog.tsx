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
  /** Pure creation provenance — `auto_default` rows render locked. */
  source: 'manual' | 'mention' | 'auto_default'
  /**
   * Mention locks (`target: '*' | toolName`). A `'*'` lock freezes the row; a
   * tool-name lock freezes just that tool's row. Mirrors `ToolsetEntry.mentions`.
   */
  mentions?: Array<{ target: string; source: string }>
  /** Toolset-shaped overrides — `{ enabledTools?: string[] }`. Drives per-tool selection. */
  config?: Record<string, unknown>
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
  /**
   * Patch a toolset's `enabled` flag and/or `enabledTools` allow-list. Backs
   * the MCP detail view's "Add all tools" button and the row-level MCP enable
   * (which writes the full allow-list snapshot); per-tool clicks go through
   * `onToggleTool`.
   */
  onUpdateToolset?: (
    slug: string,
    patch: { enabled?: boolean; enabledTools?: string[] }
  ) => void | Promise<void>
  /**
   * Toggle one tool inside an MCP toolset's allow-list. The handler owns the
   * read-modify-write against fresh state (see `useToolsetMutations.toggleTool`)
   * so rapid clicks chain correctly. When this or `onUpdateToolset` is omitted,
   * MCP servers fall back to a single whole-server toggle (used by surfaces
   * whose storage doesn't honor `enabledTools`).
   */
  onToggleTool?: (slug: string, toolName: string, allToolNames: string[]) => void | Promise<void>
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
type ListTab = 'all' | 'apps' | 'mcps'

interface InstalledState {
  enabled: boolean
  source: InstalledToolsetEntry['source']
  mentions: Array<{ target: string; source: string }>
  /**
   * Allow-list of registered tool names enabled inside this toolset. `null`
   * when the entry carries no list — explicit bundles, or legacy rows from
   * before the allow-list flip — which means every tool passes.
   */
  enabledTools: string[] | null
}

/** Row-level lock: any mention pins the row (disabling it would kill the mentioned tool); seeded defaults are locked too. */
function rowLockOf(state: InstalledState | undefined): 'mention' | 'auto_default' | undefined {
  if (!state) return undefined
  if (state.mentions.length > 0) return 'mention'
  if (state.source === 'auto_default') return 'auto_default'
  return undefined
}

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
  onUpdateToolset,
  onToggleTool,
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
      const stored = row.config?.enabledTools
      const enabledTools = Array.isArray(stored) ? (stored as string[]) : null
      map.set(row.slug, {
        enabled: row.enabled,
        source: row.source,
        mentions: row.mentions ?? [],
        enabledTools,
      })
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
    return state.enabled || state.mentions.length > 0
  }

  function lockOf(slug: string): 'mention' | 'auto_default' | undefined {
    return rowLockOf(installedState.get(slug))
  }

  // Per-tool lock: a '*' mention freezes every tool; a tool-name mention
  // freezes only that name. Seeded defaults freeze all (open question 4).
  function toolLockOf(slug: string, toolName: string): 'mention' | 'auto_default' | undefined {
    const state = installedState.get(slug)
    if (!state) return undefined
    if (state.mentions.some((m) => m.target === '*' || m.target === toolName)) return 'mention'
    if (state.source === 'auto_default') return 'auto_default'
    return undefined
  }

  // A tool is enabled when its toolset is installed AND the tool's registered
  // name is in the toolset's allow-list (no list = legacy pass-all).
  function isToolEnabled(slug: string, toolName: string): boolean {
    if (!isInstalled(slug)) return false
    const list = installedState.get(slug)?.enabledTools
    return list === null || list === undefined || list.includes(toolName)
  }

  const handleToolsetClick = (slug: string) => {
    const installed = isInstalled(slug)
    // Locked rows: clicking is a no-op (the row still shows the green check).
    if (installed && lockOf(slug)) return
    // Enabling an implicit toolset (MCP server, ungrouped app tools) at row
    // level persists the full allow-list snapshot — "enable everything it has
    // today", never a standing subscription to future tools. Mirrors the
    // server's implicit-snapshot rule so the optimistic cache matches the
    // persisted row. A re-enable keeps an existing selection.
    if (!installed && onUpdateToolset) {
      const entry = flat.find((e) => e.slug === slug)
      if (entry?.implicit) {
        const existing = installedState.get(slug)?.enabledTools
        void onUpdateToolset(slug, {
          enabled: true,
          ...(existing ? {} : { enabledTools: entry.tools.map((t) => t.name) }),
        })
        return
      }
    }
    void onToggleToolset(slug, !installed)
  }

  const handleRemove = (slug: string) => {
    if (lockOf(slug)) return
    void onToggleToolset(slug, false)
  }

  const handleOpenApp = (appNode: CatalogContainerNode) => {
    setSelectedAppId(appNode.id)
    setViewMode('app-detail')
    setSearch('')
  }

  const handleBack = () => {
    setViewMode('list')
    setTab(selectedApp?.origin === 'mcp' ? 'mcps' : 'apps')
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
                isToolEnabled={isToolEnabled}
                lockOf={lockOf}
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
                  lockOf={lockOf}
                  toolLockOf={toolLockOf}
                  isToolEnabled={isToolEnabled}
                  onToggle={handleToolsetClick}
                  onToggleTool={onToggleTool}
                  onRemove={handleRemove}
                  onUpdateToolset={onUpdateToolset}
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
  isToolEnabled: (slug: string, toolName: string) => boolean
  lockOf: (slug: string) => 'mention' | 'auto_default' | undefined
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
  isToolEnabled,
  lockOf,
  onToggle,
  onRemove,
  onOpenApp,
}: ListViewProps) {
  const filteredFlat = useMemo(
    () => flat.filter((e) => matchesToolsetSearch(e, search)),
    [flat, search]
  )

  const popular = filteredFlat.filter((e) => e.isPopular)
  const appTools = filteredFlat.filter((e) => e.origin !== 'mcp')
  const mcpTools = filteredFlat.filter((e) => e.origin === 'mcp')

  const apps = useMemo<CatalogContainerNode[]>(() => {
    if (!catalog) return []
    const roots = catalog.filter(
      (n): n is CatalogContainerNode => n.kind !== 'toolset' && n.origin !== 'mcp'
    )
    if (!search.trim()) return roots
    const q = search.trim().toLowerCase()
    return roots.filter((r) => r.label.toLowerCase().includes(q))
  }, [catalog, search])

  const mcpServers = useMemo<CatalogContainerNode[]>(() => {
    if (!catalog) return []
    const roots = catalog.filter(
      (n): n is CatalogContainerNode => n.kind !== 'toolset' && n.origin === 'mcp'
    )
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
            <TabsTrigger value='mcps'>MCPs</TabsTrigger>
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

      <ScrollArea viewportClassName='max-h-[32rem]' scrollbarClassName='w-1!'>
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
                          locked={lockOf(entry.slug)}
                          onSelect={() => onToggle(entry.slug)}
                          onRemove={() => onRemove(entry.slug)}
                        />
                      ))}
                    </div>
                  </Section>
                )}
                {appTools.length > 0 && (
                  <Section title='Apps'>
                    {appTools.map((entry) => (
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
                        locked={lockOf(entry.slug)}
                        onSelect={() => onToggle(entry.slug)}
                        onRemove={() => onRemove(entry.slug)}
                      />
                    ))}
                  </Section>
                )}
                {mcpTools.length > 0 && (
                  <Section title='MCP'>
                    {mcpTools.map((entry) => (
                      <ToolSelectRow
                        key={entry.slug}
                        id={entry.slug}
                        iconId={entry.iconId}
                        color={entry.color || null}
                        label={entry.fullLabel}
                        description={entry.description || undefined}
                        badge={toolCountBadge(entry.tools.length) ?? undefined}
                        toolNames={entry.tools.map((t) => t.displayName)}
                        isMcp
                        installed={isInstalled(entry.slug)}
                        locked={lockOf(entry.slug)}
                        onSelect={() => onToggle(entry.slug)}
                        onRemove={() => onRemove(entry.slug)}
                      />
                    ))}
                  </Section>
                )}
              </div>
            )
          ) : (tab === 'mcps' ? mcpServers : apps).length === 0 ? (
            <EmptySearchResult search={search} />
          ) : (
            <div className='space-y-1'>
              {(tab === 'mcps' ? mcpServers : apps).map((appNode) => {
                const counts = countTools(appNode, isInstalled, isToolEnabled)
                return (
                  <ToolSelectRow
                    key={appNode.id}
                    id={appNode.id}
                    iconId={appNode.iconId ?? 'package'}
                    color={appNode.color}
                    label={appNode.label}
                    subtitle={`${counts.installed}/${counts.total} ${pluralize(counts.total, 'tool')} installed`}
                    isMcp={tab === 'mcps'}
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
  lockOf: (slug: string) => 'mention' | 'auto_default' | undefined
  /** Per-tool lock — `'*'` mentions freeze every tool, tool-name mentions just theirs. */
  toolLockOf: (slug: string, toolName: string) => 'mention' | 'auto_default' | undefined
  isToolEnabled: (slug: string, toolName: string) => boolean
  onToggle: (slug: string) => void
  onToggleTool?: (slug: string, toolName: string, allToolNames: string[]) => void | Promise<void>
  onRemove: (slug: string) => void
  onUpdateToolset?: (
    slug: string,
    patch: { enabled?: boolean; enabledTools?: string[] }
  ) => void | Promise<void>
  onAddAll: (slugs: string[]) => void
  /** When false, an inline hint appears prompting the admin to pick a credential. */
  hasBoundAccount: boolean
}

/**
 * App detail — one row per **selection unit**. Explicit toolsets render as
 * atomic bundle rows (click toggles the bundle); implicit toolsets (MCP
 * servers, ungrouped app tools) contribute one selectable row per tool. An
 * app may mix both. Falls back to whole-toolset rows for implicit sets when
 * the surface can't persist per-tool allow-lists (`onToggleTool` /
 * `onUpdateToolset` omitted).
 */
function AppDetailView({
  app,
  isInstalled,
  lockOf,
  toolLockOf,
  isToolEnabled,
  onToggle,
  onToggleTool,
  onRemove,
  onUpdateToolset,
  onAddAll,
}: AppDetailViewProps) {
  const leaves = useMemo(() => flattenCatalogToToolsets([app]), [app])
  const perToolCapable = Boolean(onToggleTool && onUpdateToolset)

  const counts = useMemo(() => {
    let total = 0
    let installed = 0
    for (const leaf of leaves) {
      total += leaf.tools.length
      if (leaf.implicit && perToolCapable) {
        for (const tool of leaf.tools) if (isToolEnabled(leaf.slug, tool.name)) installed++
      } else if (isInstalled(leaf.slug)) {
        installed += leaf.tools.length
      }
    }
    return { total, installed }
  }, [leaves, perToolCapable, isInstalled, isToolEnabled])
  const allInstalled = counts.installed === counts.total && counts.total > 0

  const handleAddAll = () => {
    const wholeToggleSlugs: string[] = []
    for (const leaf of leaves) {
      if (leaf.implicit && perToolCapable) {
        // Implicit sets persist the full allow-list snapshot — "everything it
        // has today", never a standing subscription to future tools.
        void onUpdateToolset?.(leaf.slug, {
          enabled: true,
          enabledTools: leaf.tools.map((t) => t.name),
        })
      } else if (!isInstalled(leaf.slug)) {
        wholeToggleSlugs.push(leaf.slug)
      }
    }
    onAddAll(wholeToggleSlugs)
  }

  return (
    <>
      <div className='flex items-center justify-between border-b ps-3 pe-2 py-1'>
        <span className='text-xs text-muted-foreground'>
          {counts.installed}/{counts.total} {pluralize(counts.total, 'tool')} installed
        </span>
        <Button size='sm' variant='ghost' disabled={allInstalled} onClick={handleAddAll}>
          {allInstalled ? 'All installed' : 'Add all tools'}
        </Button>
      </div>

      <ScrollArea viewportClassName='max-h-[32rem]' scrollbarClassName='w-1!'>
        <div className='p-3'>
          {leaves.map((leaf) =>
            leaf.implicit && perToolCapable ? (
              leaf.tools.map((tool) => (
                <ToolSelectRow
                  key={tool.name}
                  id={tool.name}
                  iconId={leaf.iconId}
                  color={leaf.color || null}
                  label={tool.displayName}
                  description={tool.description || undefined}
                  installed={isToolEnabled(leaf.slug, tool.name)}
                  locked={toolLockOf(leaf.slug, tool.name)}
                  onSelect={() =>
                    void onToggleTool?.(
                      leaf.slug,
                      tool.name,
                      leaf.tools.map((t) => t.name)
                    )
                  }
                  onRemove={() =>
                    void onToggleTool?.(
                      leaf.slug,
                      tool.name,
                      leaf.tools.map((t) => t.name)
                    )
                  }
                />
              ))
            ) : (
              <ToolSelectRow
                key={leaf.slug}
                id={leaf.slug}
                iconId={leaf.iconId}
                color={leaf.color || null}
                label={leaf.fullLabel}
                description={leaf.description || undefined}
                badge={toolCountBadge(leaf.tools.length) ?? undefined}
                toolNames={leaf.tools.map((t) => t.displayName)}
                installed={isInstalled(leaf.slug)}
                locked={lockOf(leaf.slug)}
                onSelect={() => onToggle(leaf.slug)}
                onRemove={() => onRemove(leaf.slug)}
              />
            )
          )}
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

/** Tool-granular counts for an app row — everything counts tools, not toolsets. */
function countTools(
  node: CatalogNode,
  isInstalled: (slug: string) => boolean,
  isToolEnabled: (slug: string, toolName: string) => boolean
): { total: number; installed: number } {
  if (node.kind === 'tool') {
    return { total: 1, installed: isToolEnabled(node.toolsetSlug, node.name) ? 1 : 0 }
  }
  if (node.kind === 'toolset') {
    if (node.implicit) {
      let installed = 0
      for (const tool of node.children) if (isToolEnabled(node.slug, tool.name)) installed++
      return { total: node.children.length, installed }
    }
    return {
      total: node.children.length,
      installed: isInstalled(node.slug) ? node.children.length : 0,
    }
  }
  let total = 0
  let installed = 0
  for (const child of node.children) {
    const sub = countTools(child, isInstalled, isToolEnabled)
    total += sub.total
    installed += sub.installed
  }
  return { total, installed }
}
