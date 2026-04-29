// packages/ui/src/components/kb/layout/kb-sidebar-tree.tsx
'use client'

import { AnimatedCollapsibleContent, CollapsibleChevron } from '@auxx/ui/components/collapsible'
import { cn } from '@auxx/ui/lib/utils'
import Link from 'next/link'
import {
  type ArticleSlugFields,
  type ArticleTreeNode,
  buildArticleTree,
  getFullSlugPath,
} from '../utils'

export type KBSidebarListStyle = 'default' | 'pill' | 'line'

export interface KBSidebarArticle extends ArticleSlugFields {
  title: string
  emoji?: string | null
  isCategory?: boolean
}

interface KBSidebarTreeProps<T extends KBSidebarArticle> {
  articles: T[]
  /** Base path prepended to article slugs, e.g. `/<orgSlug>/<kbSlug>` (no trailing slash). */
  basePath: string
  activeArticleId?: string
  listStyle?: KBSidebarListStyle
  /** Controlled open-state map keyed by article id. Defaults to "auto-open if subtree contains active". */
  openIds?: Record<string, boolean>
  onToggle?: (articleId: string, next: boolean) => void
  /** Intercept article-link clicks (admin preview uses this to swap article without navigation). */
  onArticleClick?: (articleId: string) => void
}

export function KBSidebarTree<T extends KBSidebarArticle>({
  articles,
  basePath,
  activeArticleId,
  listStyle = 'default',
  openIds,
  onToggle,
  onArticleClick,
}: KBSidebarTreeProps<T>) {
  const tree = buildArticleTree(articles)
  return (
    <ul className='m-0 list-none p-0'>
      {tree.map((node) => (
        <TreeBranch
          key={node.id}
          node={node}
          allArticles={articles}
          basePath={basePath}
          activeArticleId={activeArticleId}
          listStyle={listStyle}
          openIds={openIds}
          onToggle={onToggle}
          onArticleClick={onArticleClick}
        />
      ))}
    </ul>
  )
}

interface TreeBranchProps<T extends KBSidebarArticle> {
  node: ArticleTreeNode<T>
  allArticles: T[]
  basePath: string
  activeArticleId?: string
  listStyle: KBSidebarListStyle
  depth?: number
  openIds?: Record<string, boolean>
  onToggle?: (articleId: string, next: boolean) => void
  onArticleClick?: (articleId: string) => void
}

function TreeBranch<T extends KBSidebarArticle>({
  node,
  allArticles,
  basePath,
  activeArticleId,
  listStyle,
  depth = 0,
  openIds,
  onToggle,
  onArticleClick,
}: TreeBranchProps<T>) {
  const hasChildren = node.children.length > 0
  const containsActive = activeArticleId ? subtreeContainsId(node, activeArticleId) : false
  const explicit = openIds?.[node.id]
  const open = explicit ?? (containsActive || depth < 1)

  const slugPath = getFullSlugPath(node, allArticles)
  const href = `${basePath}/${slugPath}`
  const active = activeArticleId === node.id

  return (
    <li className='my-0.5'>
      <div className='flex items-center'>
        {hasChildren ? (
          <button
            type='button'
            className='inline-flex h-5 w-5 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-current'
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => onToggle?.(node.id, !open)}>
            <CollapsibleChevron open={open} className='size-3' />
          </button>
        ) : null}
        {node.isCategory ? (
          <button
            type='button'
            className={cn(itemClass(listStyle), 'cursor-pointer text-left')}
            data-active={active}
            onClick={() => onToggle?.(node.id, !open)}>
            {node.emoji ? (
              <span aria-hidden className='shrink-0'>
                {node.emoji}
              </span>
            ) : null}
            <span className='truncate'>{node.title}</span>
          </button>
        ) : onArticleClick ? (
          <button
            type='button'
            className={cn(itemClass(listStyle), 'cursor-pointer text-left')}
            data-active={active}
            onClick={() => onArticleClick(node.id)}>
            {node.emoji ? (
              <span aria-hidden className='shrink-0'>
                {node.emoji}
              </span>
            ) : null}
            <span className='truncate'>{node.title}</span>
          </button>
        ) : (
          <Link href={href} className={itemClass(listStyle)} data-active={active} prefetch={false}>
            {node.emoji ? (
              <span aria-hidden className='shrink-0'>
                {node.emoji}
              </span>
            ) : null}
            <span className='truncate'>{node.title}</span>
          </Link>
        )}
      </div>
      {hasChildren ? (
        <AnimatedCollapsibleContent
          open={open}
          className='ml-2.5 border-l border-[var(--kb-border)] pl-2'>
          <ul className='m-0 list-none p-0'>
            {node.children.map((child) => (
              <TreeBranch
                key={child.id}
                node={child}
                allArticles={allArticles}
                basePath={basePath}
                activeArticleId={activeArticleId}
                listStyle={listStyle}
                depth={depth + 1}
                openIds={openIds}
                onToggle={onToggle}
                onArticleClick={onArticleClick}
              />
            ))}
          </ul>
        </AnimatedCollapsibleContent>
      ) : null}
    </li>
  )
}

function itemClass(listStyle: KBSidebarListStyle): string {
  return cn(
    'flex flex-1 items-center gap-2 px-2 py-1.5 text-sm leading-tight text-[var(--kb-fg)] no-underline transition-colors',
    'hover:bg-[var(--kb-muted)] hover:text-[var(--kb-primary)]',
    listStyle === 'default' &&
      'rounded-[var(--kb-radius)] data-[active=true]:bg-[var(--kb-tint)] data-[active=true]:text-[var(--kb-primary)] data-[active=true]:font-medium',
    listStyle === 'pill' &&
      'rounded-full data-[active=true]:bg-[var(--kb-primary)] data-[active=true]:text-[var(--kb-bg)] data-[active=true]:font-medium data-[active=true]:hover:bg-[var(--kb-primary)] data-[active=true]:hover:text-[var(--kb-bg)]',
    listStyle === 'line' &&
      'rounded-none border-l-2 border-transparent data-[active=true]:border-[var(--kb-primary)] data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-[var(--kb-primary)]'
  )
}

function subtreeContainsId<T extends ArticleSlugFields>(
  node: ArticleTreeNode<T>,
  id: string
): boolean {
  if (node.id === id) return true
  for (const child of node.children) {
    if (subtreeContainsId(child, id)) return true
  }
  return false
}
