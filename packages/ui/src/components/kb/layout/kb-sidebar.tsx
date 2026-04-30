// packages/ui/src/components/kb/layout/kb-sidebar.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useState } from 'react'
import { KBSearchInput } from '../search/kb-search-input'
import { useKBLayoutContext } from './kb-layout-context'
import { readOpenIds, writeOpenIds } from './kb-sidebar-state'
import { filterToTab, findTabForArticle, getTopLevelTabs, KBSidebarTabs } from './kb-sidebar-tabs'
import { type KBSidebarArticle, type KBSidebarListStyle, KBSidebarTree } from './kb-sidebar-tree'

interface KBSidebarProps<T extends KBSidebarArticle> {
  articles: T[]
  basePath: string
  activeArticleId?: string
  searchOrigin?: string
  showSearch?: boolean
  listStyle?: KBSidebarListStyle
  onArticleClick?: (articleId: string) => void
}

export function KBSidebar<T extends KBSidebarArticle>({
  articles,
  basePath,
  activeArticleId,
  searchOrigin,
  showSearch = false,
  listStyle = 'default',
  onArticleClick,
}: KBSidebarProps<T>) {
  const { kbId, collapsed, setCollapsed, mobileOpen, setMobileOpen } = useKBLayoutContext()

  const tabs = getTopLevelTabs(articles)
  const initialTab = findTabForArticle(tabs, articles, activeArticleId)
  const [activeTabId, setActiveTabId] = useState<string | null>(initialTab)
  useEffect(() => {
    setActiveTabId(findTabForArticle(tabs, articles, activeArticleId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArticleId, articles.length])

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

  const visible = tabs.length >= 2 ? filterToTab(articles, activeTabId) : articles

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
      {tabs.length >= 2 ? (
        <KBSidebarTabs tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} />
      ) : null}
      <KBSidebarTree
        articles={visible}
        basePath={basePath}
        activeArticleId={activeArticleId}
        listStyle={listStyle}
        openIds={openIds}
        onToggle={handleToggle}
        onArticleClick={onArticleClick}
        animate={animateTree}
      />
    </div>
  )

  return (
    <>
      {/* Desktop persistent sidebar */}
      <div className='relative hidden shrink-0 @kb-md:flex @kb-md:flex-col'>
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
            'absolute top-3 bottom-3 left-3 w-[min(18rem,calc(100%-1.5rem))] overflow-hidden rounded-[var(--kb-radius)] border border-[var(--kb-border)] bg-[var(--kb-sidebar-bg)] shadow-2xl transition-transform duration-200 ease-out',
            mobileOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1rem)]'
          )}>
          {inner}
        </aside>
      </div>
    </>
  )
}
