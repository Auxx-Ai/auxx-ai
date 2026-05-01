// apps/web/src/components/kb/utils/infer-create-parent.ts
import type { ArticleMeta } from '../store/article-store'

/**
 * Decide where a newly-created page/category should live when the user clicks
 * the panel's "+ Add" button. Headers are real containers in the tree, so the
 * natural default is: if the user is editing an article inside a header
 * section, drop the new article into that section. Otherwise fall back to the
 * enclosing tab (or KB root when no tab is active).
 *
 * If the active article doesn't belong to `tabId` (the user just switched
 * tabs and the URL/active hasn't caught up — or the new tab is empty so it
 * never will), ignore the active chain entirely and create at `tabId`.
 *
 * Returns `tabId` (which may itself be null in tab-less KBs) when no article
 * is active or the active chain doesn't match.
 */
export function inferCreateParent(
  active: ArticleMeta | undefined,
  tabId: string | null,
  articles: ArticleMeta[]
): string | null {
  if (!active) return tabId

  // Resolve the tab that actually encloses `active`. Null means the active
  // article lives at KB root.
  let activeTabId: string | null = null
  let walker: ArticleMeta | undefined = active
  while (walker) {
    if (walker.articleKind === 'tab') {
      activeTabId = walker.id
      break
    }
    walker = walker.parentId ? articles.find((a) => a.id === walker!.parentId) : undefined
  }
  if (activeTabId !== tabId) return tabId

  let cursor: ArticleMeta | undefined = active
  while (cursor) {
    if (cursor.articleKind === 'header') return cursor.id
    if (cursor.articleKind === 'tab') return cursor.id
    cursor = cursor.parentId ? articles.find((a) => a.id === cursor!.parentId) : undefined
  }
  return tabId
}
