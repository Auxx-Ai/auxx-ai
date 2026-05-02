// packages/ui/src/components/kb/layout/kb-sidebar.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { KBSearchInput } from '../search/kb-search-input'
import { KBModeToggle } from '../theme/kb-mode-toggle'
import type { KBMode } from '../theme/kb-theme-tokens'
import { useKBLayoutContext } from './kb-layout-context'
import { readOpenIds, writeOpenIds } from './kb-sidebar-state'
import { type KBSidebarArticle, type KBSidebarListStyle, KBSidebarTree } from './kb-sidebar-tree'
import { KBTabSelect } from './kb-tab-select'

interface KBSidebarProps<T extends KBSidebarArticle> {
  articles: T[]
  basePath: string
  activeArticleId?: string
  searchOrigin?: string
  showSearch?: boolean
  listStyle?: KBSidebarListStyle
  onArticleClick?: (articleId: string) => void
  /** Mobile drawer header — logo + theme toggle. */
  homeHref?: string
  title?: string
  logoLight?: string | null
  logoDark?: string | null
  mode?: KBMode
  showMode?: boolean
  /** Tabs for the mobile-only `<KBTabSelect>`. Empty hides the dropdown. */
  tabs?: T[]
  activeTabId?: string | null
  tabHrefs?: Record<string, string>
  /** Forwarded to `<KBTabSelect>` so the admin preview can intercept tab clicks. */
  onTabSelect?: (tabId: string) => void
  /** Notified when the mobile-drawer mode toggle flips. Keeps external state in sync. */
  onModeChange?: (mode: KBMode) => void
}

export function KBSidebar<T extends KBSidebarArticle>({
  articles,
  basePath,
  activeArticleId,
  searchOrigin,
  showSearch = false,
  listStyle = 'default',
  onArticleClick,
  homeHref,
  title,
  logoLight,
  logoDark,
  mode = 'light',
  showMode = true,
  tabs,
  activeTabId,
  tabHrefs,
  onTabSelect,
  onModeChange,
}: KBSidebarProps<T>) {
  const { kbId, collapsed, setCollapsed, mobileOpen, setMobileOpen } = useKBLayoutContext()

  const [openIds, setOpenIds] = useState<Record<string, boolean>>({})
  const [animateTree, setAnimateTree] = useState(false)
  useEffect(() => {
    setOpenIds(readOpenIds(kbId))
    const id = requestAnimationFrame(() => setAnimateTree(true))
    return () => cancelAnimationFrame(id)
  }, [kbId])

  // Close drawer on Escape.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen, setMobileOpen])

  const handleToggle = (articleId: string, next: boolean) => {
    setOpenIds((prev) => {
      const updated = { ...prev, [articleId]: next }
      writeOpenIds(kbId, updated)
      return updated
    })
  }

  const inner = (
    <div
      data-slot='kb-sidebar-inner'
      className={cn(
        'flex flex-1 flex-col gap-2 overflow-y-auto',
        listStyle === 'pill' ? 'm-3 rounded-2xl bg-[var(--kb-muted)]/50 px-3 py-4' : 'px-4 py-6'
      )}>
      {showSearch ? (
        <div className='mb-1'>
          <KBSearchInput searchOrigin={searchOrigin ?? ''} basePath={basePath} />
        </div>
      ) : null}
      {tabs && tabs.length >= 2 && tabHrefs ? (
        <div className='mb-2 @kb-md:hidden'>
          <KBTabSelect
            tabs={tabs}
            activeTabId={activeTabId ?? null}
            tabHrefs={tabHrefs}
            onTabSelect={onTabSelect}
            onNavigate={() => setMobileOpen(false)}
          />
        </div>
      ) : null}
      <KBSidebarTree
        articles={articles}
        basePath={basePath}
        activeArticleId={activeArticleId}
        listStyle={listStyle}
        openIds={openIds}
        onToggle={handleToggle}
        onArticleClick={onArticleClick}
        animate={animateTree}
        rootParentId={activeTabId ?? null}
      />
    </div>
  )

  return (
    <>
      {/* Desktop persistent sidebar */}
      <div className='relative hidden shrink-0 @kb-md:sticky @kb-md:top-[calc(var(--kb-top-offset,0px)+var(--kb-header-h,3.5rem)+var(--kb-tabs-h,0px))] @kb-md:flex @kb-md:h-[calc(100dvh_-_var(--kb-top-offset,0px)_-_var(--kb-header-h,3.5rem)_-_var(--kb-tabs-h,0px))] @kb-md:max-h-full @kb-md:flex-col @kb-md:self-start'>
        <aside
          data-slot='kb-sidebar'
          data-collapsed={collapsed}
          className={cn(
            'flex flex-1 flex-col overflow-hidden',
            listStyle !== 'pill' && 'border-r border-[var(--kb-border)] bg-[var(--kb-sidebar-bg)]',
            'transition-[width,border-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            collapsed ? 'w-0 border-transparent' : 'w-72'
          )}>
          <div
            className={cn(
              'flex w-72 flex-1 flex-col transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
              collapsed
                ? 'pointer-events-none -translate-x-4 opacity-0'
                : 'translate-x-0 opacity-100'
            )}>
            {inner}
          </div>
        </aside>
        {listStyle === 'default' && !collapsed ? (
          <button
            type='button'
            aria-label='Toggle sidebar'
            title='Toggle sidebar'
            tabIndex={-1}
            onClick={() => setCollapsed((v) => !v)}
            className='group absolute inset-y-0 -right-2 z-20 flex w-4 cursor-ew-resize border-0 bg-transparent p-0'>
            <span className='pointer-events-none mx-auto h-full w-[2px] bg-transparent transition-colors group-hover:bg-[var(--kb-border)]' />
          </button>
        ) : null}
      </div>

      {/* Mobile in-place drawer (constrained to KB layout root, not document.body) */}
      <div
        aria-hidden={!mobileOpen}
        className={cn(
          'absolute inset-0 z-40 transition-opacity duration-200 @kb-md:hidden',
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is decorative; Escape handler covers keyboard close */}
        <div
          className='absolute inset-0 bg-black/40'
          onClick={() => setMobileOpen(false)}
          role='presentation'
        />
        <aside
          className={cn(
            'absolute top-3 bottom-3 left-3 flex w-[min(18rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-[var(--kb-radius)] border border-[var(--kb-border)] bg-[var(--kb-sidebar-bg)] shadow-2xl transition-transform duration-200 ease-out',
            mobileOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1rem)]'
          )}>
          <KBSidebarMobileHeader
            kbId={kbId}
            homeHref={homeHref}
            title={title}
            logoLight={logoLight}
            logoDark={logoDark}
            mode={mode}
            showMode={showMode}
            onModeChange={onModeChange}
            onNavigate={() => setMobileOpen(false)}
          />
          {inner}
        </aside>
      </div>
    </>
  )
}

interface KBSidebarMobileHeaderProps {
  kbId: string
  homeHref?: string
  title?: string
  logoLight?: string | null
  logoDark?: string | null
  mode: KBMode
  showMode: boolean
  onModeChange?: (mode: KBMode) => void
  onNavigate: () => void
}

function KBSidebarMobileHeader({
  kbId,
  homeHref,
  title,
  logoLight,
  logoDark,
  mode,
  showMode,
  onModeChange,
  onNavigate,
}: KBSidebarMobileHeaderProps) {
  const logo = (mode === 'dark' ? logoDark || logoLight : logoLight || logoDark) || null
  const label = title ?? 'Home'
  return (
    <div className='flex items-center gap-2 border-b border-[var(--kb-border)] px-4 py-3'>
      <Link
        href={homeHref ?? '/'}
        onClick={onNavigate}
        className='inline-flex items-center gap-2 font-semibold text-[var(--kb-fg)] no-underline'>
        {logo ? (
          <img src={logo} alt={label} className='h-7 w-auto' />
        ) : (
          <span className='text-base'>{label}</span>
        )}
      </Link>
      <div className='flex-1' />
      {showMode ? <KBModeToggle kbId={kbId} initialMode={mode} onChange={onModeChange} /> : null}
    </div>
  )
}
