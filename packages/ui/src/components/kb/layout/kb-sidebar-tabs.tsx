// packages/ui/src/components/kb/layout/kb-sidebar-tabs.tsx
'use client'

import type { KBSidebarArticle } from './kb-sidebar-tree'

/**
 * Returns the KB's tabs in display order. Tabs are top-level articles with
 * `articleKind === 'tab'`.
 */
export function getTopLevelTabs<T extends KBSidebarArticle>(articles: T[]): T[] {
  return articles
    .filter((a) => a.articleKind === 'tab')
    .sort((a, b) => {
      const ao = (a as T & { order?: number }).order ?? 0
      const bo = (b as T & { order?: number }).order ?? 0
      return ao - bo
    })
}

/**
 * Walk up `parentId` from `activeArticleId` to find the enclosing tab. Falls
 * back to the first tab.
 */
export function findTabForArticle<T extends KBSidebarArticle>(
  tabs: T[],
  articles: T[],
  activeArticleId: string | undefined
): string | null {
  if (!activeArticleId) return tabs[0]?.id ?? null
  let current = articles.find((a) => a.id === activeArticleId)
  while (current) {
    if (current.articleKind === 'tab') {
      if (tabs.some((t) => t.id === current?.id)) return current.id
      return tabs[0]?.id ?? null
    }
    if (current.parentId === null) break
    const next: T | undefined = articles.find((a) => a.id === current?.parentId)
    if (!next) break
    current = next
  }
  return tabs[0]?.id ?? null
}

/**
 * Subtree filter: returns the tab and every descendant article. Used to scope
 * the sidebar tree to the active tab.
 */
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
