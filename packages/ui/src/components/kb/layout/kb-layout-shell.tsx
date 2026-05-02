// packages/ui/src/components/kb/layout/kb-layout-shell.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useSelectedLayoutSegments } from 'next/navigation'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { KBSearchDialog } from '../search/kb-search-dialog'
import type { KBMode } from '../theme/kb-theme-tokens'
import { findArticleBySlugPath, findFirstNavigableUnder, getFullSlugPath } from '../utils'
import { KBFooter } from './kb-footer'
import { KBHeader, type KBNavLink } from './kb-header'
import { KBLayoutContextProvider } from './kb-layout-context'
import { KBSidebar } from './kb-sidebar'
import { KBSidebarMobileTrigger } from './kb-sidebar-mobile-trigger'
import { readCollapsedFromStorage, writeCollapsedToStorage } from './kb-sidebar-state'
import { findTabForArticle, getTopLevelTabs } from './kb-sidebar-tabs'
import { KBSidebarToggle } from './kb-sidebar-toggle'
import type { KBSidebarArticle, KBSidebarListStyle } from './kb-sidebar-tree'
import { KBTopTabs } from './kb-top-tabs'

interface KBLayoutShellProps<T extends KBSidebarArticle> {
  kbId: string
  kbName: string
  articles: T[]
  basePath: string
  searchOrigin?: string
  activeArticleId?: string
  effectiveMode: KBMode
  showMode: boolean
  headerEnabled: boolean
  footerEnabled: boolean
  searchbarPosition: 'center' | 'corner'
  logoLight?: string | null
  logoDark?: string | null
  headerNav: KBNavLink[]
  footerNav: KBNavLink[]
  listStyle: KBSidebarListStyle
  onArticleClick?: (articleId: string) => void
  /** When true, the `<main>` element owns the scroll instead of the document. Used inside admin previews where document scroll is unavailable. */
  mainScroll?: boolean
  children: ReactNode
}

export function KBLayoutShell<T extends KBSidebarArticle>({
  kbId,
  kbName,
  articles,
  basePath,
  searchOrigin,
  activeArticleId,
  effectiveMode,
  showMode,
  headerEnabled,
  footerEnabled,
  searchbarPosition,
  logoLight,
  logoDark,
  headerNav,
  footerNav,
  listStyle,
  onArticleClick,
  mainScroll = false,
  children,
}: KBLayoutShellProps<T>) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const segments = useSelectedLayoutSegments()
  const derivedActiveId = useMemo(() => {
    if (segments.length === 0) return undefined
    return findArticleBySlugPath(articles, segments)?.id
  }, [articles, segments])
  const effectiveActiveId = activeArticleId ?? derivedActiveId

  // Tabs are the source of truth for the active section. Walk the parent chain
  // from the active article to find its enclosing tab, fall back to the first
  // tab when nothing is selected.
  const tabs = useMemo(() => getTopLevelTabs(articles), [articles])
  const activeTabId = useMemo(
    () => findTabForArticle(tabs, articles, effectiveActiveId),
    [tabs, articles, effectiveActiveId]
  )
  // KBSidebar receives the full article set so `getFullSlugPath` can walk the
  // entire parent chain (including the tab) when constructing hrefs. The tree
  // is scoped to the active tab via `rootParentId={activeTabId}` on KBSidebar →
  // KBSidebarTree, so the tab itself isn't rendered as a duplicate root node.

  // Click-target for each tab pill: the deepest first navigable descendant.
  // `tabHrefs` powers public-site `<Link>` navigation; `tabFirstArticleIds` is
  // used by the admin preview to switch articles without touching the URL.
  const { tabHrefs, tabFirstArticleIds } = useMemo(() => {
    const hrefs: Record<string, string> = {}
    const firstIds: Record<string, string | null> = {}
    for (const tab of tabs) {
      const first = findFirstNavigableUnder(tab.id, articles)
      const slug = first ? getFullSlugPath(first, articles) : ''
      hrefs[tab.id] = slug ? `${basePath}/${slug}` : basePath || '/'
      firstIds[tab.id] = first?.id ?? null
    }
    return { tabHrefs: hrefs, tabFirstArticleIds: firstIds }
  }, [tabs, articles, basePath])

  // Inline preview hands `onArticleClick` to swap articles in place. Tabs go
  // through this same channel so clicking a tab pill / dropdown lands on the
  // tab's first navigable descendant without an actual route change.
  const onTabSelect = onArticleClick
    ? (tabId: string) => {
        const firstId = tabFirstArticleIds[tabId]
        if (firstId) onArticleClick(firstId)
      }
    : undefined

  useEffect(() => {
    setCollapsed(readCollapsedFromStorage())
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const handleSetCollapsed = (v: boolean | ((prev: boolean) => boolean)) => {
    setCollapsed((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      writeCollapsedToStorage(next)
      return next
    })
  }

  return (
    <KBLayoutContextProvider
      value={{
        kbId,
        collapsed,
        setCollapsed: handleSetCollapsed,
        mobileOpen,
        setMobileOpen,
        searchOpen,
        setSearchOpen,
      }}>
      <KBHeader
        kbId={kbId}
        homeHref={basePath || '/'}
        basePath={basePath}
        title={kbName}
        logoLight={logoLight}
        logoDark={logoDark}
        mode={effectiveMode}
        showMode={showMode}
        navigation={headerNav}
        navigationEnabled={headerEnabled}
        searchbarPosition={searchbarPosition}
        searchOrigin={searchOrigin}
        startSlot={
          <>
            <KBSidebarMobileTrigger />
            <KBSidebarToggle className='hidden @kb-md:inline-flex' />
          </>
        }
      />
      <KBTopTabs
        tabs={tabs}
        activeTabId={activeTabId}
        tabHrefs={tabHrefs}
        onTabSelect={onTabSelect}
      />
      <div
        className={cn('mx-auto flex w-full max-w-7xl flex-1', mainScroll && 'min-h-0')}
        style={tabs.length >= 2 ? ({ '--kb-tabs-h': '2.625rem' } as CSSProperties) : undefined}>
        <KBSidebar
          articles={articles}
          basePath={basePath}
          activeArticleId={effectiveActiveId}
          searchOrigin={searchOrigin}
          showSearch={searchbarPosition === 'corner'}
          listStyle={listStyle}
          onArticleClick={onArticleClick}
          homeHref={basePath || '/'}
          title={kbName}
          logoLight={logoLight}
          logoDark={logoDark}
          mode={effectiveMode}
          showMode={showMode}
          tabs={tabs}
          activeTabId={activeTabId}
          tabHrefs={tabHrefs}
          onTabSelect={onTabSelect}
        />
        <main
          className={cn(
            'flex min-w-0 flex-1 flex-col px-4 py-8 @kb-md:px-8',
            mainScroll && 'min-h-0 overflow-y-auto'
          )}>
          {children}
        </main>
      </div>
      <KBFooter title={kbName} navigation={footerNav} navigationEnabled={footerEnabled} />
      {searchOrigin ? (
        <KBSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          searchOrigin={searchOrigin}
          basePath={basePath}
        />
      ) : null}
    </KBLayoutContextProvider>
  )
}
