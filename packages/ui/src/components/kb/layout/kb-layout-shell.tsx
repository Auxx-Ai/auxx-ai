// packages/ui/src/components/kb/layout/kb-layout-shell.tsx
'use client'

import { useSelectedLayoutSegments } from 'next/navigation'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { KBSearchDialog } from '../search/kb-search-dialog'
import type { KBMode } from '../theme/kb-theme-tokens'
import { findArticleBySlugPath, getFullSlugPath } from '../utils'
import { KBFooter } from './kb-footer'
import { KBHeader, type KBNavLink } from './kb-header'
import { KBLayoutContextProvider } from './kb-layout-context'
import { KBSidebar } from './kb-sidebar'
import { KBSidebarMobileTrigger } from './kb-sidebar-mobile-trigger'
import { readCollapsedFromStorage, writeCollapsedToStorage } from './kb-sidebar-state'
import { filterToTab, findTabForArticle, getTopLevelTabs } from './kb-sidebar-tabs'
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
  const sidebarArticles = useMemo(
    () => (tabs.length > 0 ? filterToTab(articles, activeTabId) : articles),
    [tabs, articles, activeTabId]
  )

  // Click-target for each tab pill: the deepest first navigable descendant.
  const tabHrefs = useMemo(() => {
    const map: Record<string, string> = {}
    for (const tab of tabs) {
      const first = findFirstNavigableDescendant(tab.id, articles)
      const slug = first ? getFullSlugPath(first, articles) : ''
      map[tab.id] = slug ? `${basePath}/${slug}` : basePath || '/'
    }
    return map
  }, [tabs, articles, basePath])

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
      <KBTopTabs tabs={tabs} activeTabId={activeTabId} tabHrefs={tabHrefs} />
      <div className='mx-auto flex w-full max-w-7xl flex-1'>
        <KBSidebar
          articles={sidebarArticles}
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
        />
        <main className='flex min-w-0 flex-1 flex-col px-4 py-8 @kb-md:px-8'>{children}</main>
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

/**
 * Depth-first search for the first navigable descendant of `rootId`. Tabs and
 * headers are skipped because they have no URL of their own.
 */
function findFirstNavigableDescendant<T extends KBSidebarArticle>(
  rootId: string,
  articles: T[]
): T | undefined {
  const children = articles
    .filter((a) => a.parentId === rootId)
    .sort((a, b) => {
      const ao = (a as T & { sortOrder?: string }).sortOrder ?? ''
      const bo = (b as T & { sortOrder?: string }).sortOrder ?? ''
      return ao < bo ? -1 : ao > bo ? 1 : 0
    })
  for (const child of children) {
    if (child.articleKind === 'header') {
      const grand = findFirstNavigableDescendant(child.id, articles)
      if (grand) return grand
      continue
    }
    return child
  }
  return undefined
}
