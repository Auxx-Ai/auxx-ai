// packages/ui/src/components/kb/layout/kb-sidebar-tabs.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { KBSidebarArticle } from './kb-sidebar-tree'

export interface KBSidebarTabsProps<T extends KBSidebarArticle> {
  tabs: T[]
  activeTabId: string | null
  onSelect: (tabId: string) => void
}

export function KBSidebarTabs<T extends KBSidebarArticle>({
  tabs,
  activeTabId,
  onSelect,
}: KBSidebarTabsProps<T>) {
  if (tabs.length < 2) return null
  return (
    <div className='-mx-2 mb-3 flex gap-1 overflow-x-auto border-b border-[var(--kb-border)] px-2 pb-3'>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type='button'
          onClick={() => onSelect(tab.id)}
          data-active={activeTabId === tab.id}
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-3 py-1.5 text-sm text-[var(--kb-fg)] transition-colors',
            'hover:bg-[var(--kb-muted)]',
            'data-[active=true]:bg-[var(--kb-tint)] data-[active=true]:text-[var(--kb-primary)] data-[active=true]:font-medium'
          )}>
          {tab.emoji ? <span aria-hidden>{tab.emoji}</span> : null}
          <span>{tab.title}</span>
        </button>
      ))}
    </div>
  )
}

export function getTopLevelTabs<T extends KBSidebarArticle>(articles: T[]): T[] {
  return articles
    .filter((a) => a.parentId === null && a.isCategory === true)
    .sort((a, b) => {
      const ao = (a as T & { order?: number }).order ?? 0
      const bo = (b as T & { order?: number }).order ?? 0
      return ao - bo
    })
}

export function findTabForArticle<T extends KBSidebarArticle>(
  tabs: T[],
  articles: T[],
  activeArticleId: string | undefined
): string | null {
  if (!activeArticleId) return tabs[0]?.id ?? null
  let current = articles.find((a) => a.id === activeArticleId)
  while (current) {
    if (current.parentId === null) {
      if (tabs.some((t) => t.id === current?.id)) return current.id
      return tabs[0]?.id ?? null
    }
    const next: T | undefined = articles.find((a) => a.id === current?.parentId)
    if (!next) break
    current = next
  }
  return tabs[0]?.id ?? null
}

export function filterToTab<T extends KBSidebarArticle>(articles: T[], tabId: string | null): T[] {
  if (!tabId) return articles
  const out: T[] = []
  const queue: string[] = [tabId]
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id) break
    const node = articles.find((a) => a.id === id)
    if (!node) continue
    out.push(node)
    for (const child of articles) {
      if (child.parentId === id) queue.push(child.id)
    }
  }
  return out
}
