// packages/ui/src/components/kb/layout/kb-sidebar-tree.tsx
'use client'

import { AnimatedCollapsibleContent, CollapsibleChevron } from '@auxx/ui/components/collapsible'
import { EntityIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { ExternalLink } from 'lucide-react'
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
  /** When false, branch open/close changes apply instantly (used to skip the post-hydration flash). */
  animate?: boolean
  /**
   * Root id for tree construction. When the caller passes a tab-scoped article
   * subset (descendants of `activeTabId`, tab itself excluded), the tree's
   * roots are those descendants whose `parentId === activeTabId` — not null.
   * Defaults to null for KBs without tabs.
   */
  rootParentId?: string | null
}

export function KBSidebarTree<T extends KBSidebarArticle>({
  articles,
  basePath,
  activeArticleId,
  listStyle = 'default',
  openIds,
  onToggle,
  onArticleClick,
  animate = true,
  rootParentId = null,
}: KBSidebarTreeProps<T>) {
  const tree = buildArticleTree(articles, rootParentId)
  return (
    <ul
      className={cn(
        'm-0 flex-1 list-none p-0',
        listStyle === 'line' &&
          'relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-[var(--kb-border)]'
      )}>
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
          animate={animate}
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
  animate?: boolean
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
  animate = true,
}: TreeBranchProps<T>) {
  const hasChildren = node.children.length > 0
  const containsActive = activeArticleId ? subtreeContainsId(node, activeArticleId) : false
  const explicit = openIds?.[node.id]
  const open = explicit ?? (containsActive || depth < 1)

  const slugPath = getFullSlugPath(node, allArticles)
  const href = `${basePath}/${slugPath}`
  const active = activeArticleId === node.id

  // For 'line' style we keep all items at the same horizontal anchor so the
  // ::before track stays put across depths; depth is conveyed via padding
  // inside the item instead.
  const lineIndent = listStyle === 'line' ? { paddingLeft: `${depth * 0.75 + 0.5}rem` } : undefined

  const itemContent = (
    <>
      {node.emoji ? <EntityIcon iconId={node.emoji} variant='bare' size='sm' /> : null}
      <span className='min-w-0 truncate'>{node.title}</span>
      {hasChildren ? (
        <button
          type='button'
          className='-mr-1 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-current'
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggle?.(node.id, !open)
          }}>
          <CollapsibleChevron open={open} className='size-3' />
        </button>
      ) : null}
    </>
  )

  // Link kind: render as an external anchor. The "slug" carries the URL.
  if (node.articleKind === 'link') {
    return (
      <li className={cn(listStyle === 'line' ? 'my-0' : 'my-0.5')}>
        <a
          href={node.slug || '#'}
          target='_blank'
          rel='noopener noreferrer'
          className={cn(itemClass(listStyle), 'group/link')}
          style={lineIndent}>
          {node.emoji ? <EntityIcon iconId={node.emoji} variant='bare' size='sm' /> : null}
          <span className='min-w-0 truncate'>{node.title}</span>
          <ExternalLink className='ml-auto size-3.5 opacity-0 transition-opacity group-hover/link:opacity-60' />
        </a>
      </li>
    )
  }

  // Headers are uppercase section labels rendered flat at the same depth as
  // their children. They are pure visual groupings — not navigable — so the
  // label is a static span. Children always render (no collapse).
  if (node.articleKind === 'header') {
    return (
      <li className='my-0.5 pb-4'>
        <span
          className='block px-2 pt-3 pb-1 text-[var(--kb-fg)]/60 text-xs font-semibold uppercase tracking-wide'
          style={lineIndent}>
          {node.title}
        </span>
        {hasChildren ? (
          <ul className='m-0 list-none p-0'>
            {node.children.map((child) => (
              <TreeBranch
                key={child.id}
                node={child}
                allArticles={allArticles}
                basePath={basePath}
                activeArticleId={activeArticleId}
                listStyle={listStyle}
                depth={depth}
                openIds={openIds}
                onToggle={onToggle}
                onArticleClick={onArticleClick}
                animate={animate}
              />
            ))}
          </ul>
        ) : null}
      </li>
    )
  }

  return (
    <li className={cn(listStyle === 'line' ? 'my-0' : 'my-0.5')}>
      <div className='flex items-center'>
        {onArticleClick ? (
          <button
            type='button'
            className={cn(itemClass(listStyle), 'cursor-pointer text-left')}
            data-active={active}
            style={lineIndent}
            onClick={() => {
              onArticleClick(node.id)
              if (hasChildren) onToggle?.(node.id, true)
            }}>
            {itemContent}
          </button>
        ) : (
          <Link
            href={href}
            className={itemClass(listStyle)}
            data-active={active}
            style={lineIndent}
            prefetch={false}
            onClick={() => {
              if (hasChildren) onToggle?.(node.id, true)
            }}>
            {itemContent}
          </Link>
        )}
      </div>
      {hasChildren ? (
        <AnimatedCollapsibleContent
          open={open}
          animate={animate}
          className={cn(
            'flex flex-col',
            listStyle !== 'line' && 'ml-2.5 border-l border-[var(--kb-border)] pl-2'
          )}>
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
                animate={animate}
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
    'group/item relative flex min-h-9 flex-1 items-center gap-2 px-2 py-1.5 text-sm leading-tight text-[var(--kb-fg)] no-underline transition-colors',
    'hover:bg-[var(--kb-muted)] hover:text-[var(--kb-primary)]',
    (listStyle === 'default' || listStyle === 'pill') &&
      'rounded-[var(--kb-radius)] data-[active=true]:bg-[var(--kb-muted)] data-[active=true]:text-[var(--kb-primary)] data-[active=true]:font-medium',
    listStyle === 'line' && [
      'rounded-none hover:bg-transparent',
      'before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-[var(--kb-border)] before:transition-colors',
      'hover:before:bg-[var(--kb-fg)]/30',
      'data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-[var(--kb-primary)] data-[active=true]:before:bg-[var(--kb-primary)]',
    ]
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
