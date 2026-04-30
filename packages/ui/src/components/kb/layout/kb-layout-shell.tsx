// packages/ui/src/components/kb/layout/kb-layout-shell.tsx
'use client'

import { useSelectedLayoutSegments } from 'next/navigation'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { KBSearchDialog } from '../search/kb-search-dialog'
import type { KBMode } from '../theme/kb-theme-tokens'
import { findArticleBySlugPath } from '../utils'
import { KBFooter } from './kb-footer'
import { KBHeader, type KBNavLink } from './kb-header'
import { KBLayoutContextProvider } from './kb-layout-context'
import { KBSidebar } from './kb-sidebar'
import { KBSidebarMobileTrigger } from './kb-sidebar-mobile-trigger'
import { readCollapsedFromStorage, writeCollapsedToStorage } from './kb-sidebar-state'
import { KBSidebarToggle } from './kb-sidebar-toggle'
import type { KBSidebarArticle, KBSidebarListStyle } from './kb-sidebar-tree'

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
      <div className='mx-auto flex w-full max-w-7xl flex-1'>
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
