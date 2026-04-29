// packages/ui/src/components/kb/layout/kb-sidebar-tree.tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  type ArticleSlugFields,
  type ArticleTreeNode,
  buildArticleTree,
  getFullSlugPath,
} from '../utils'
import styles from './kb-layout.module.css'

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
}

export function KBSidebarTree<T extends KBSidebarArticle>({
  articles,
  basePath,
  activeArticleId,
}: KBSidebarTreeProps<T>) {
  const tree = buildArticleTree(articles)
  return (
    <ul className={styles.tree}>
      {tree.map((node) => (
        <TreeBranch
          key={node.id}
          node={node}
          allArticles={articles}
          basePath={basePath}
          activeArticleId={activeArticleId}
        />
      ))}
    </ul>
  )
}

function TreeBranch<T extends KBSidebarArticle>({
  node,
  allArticles,
  basePath,
  activeArticleId,
  depth = 0,
}: {
  node: ArticleTreeNode<T>
  allArticles: T[]
  basePath: string
  activeArticleId?: string
  depth?: number
}) {
  const hasChildren = node.children.length > 0
  const containsActive = activeArticleId ? subtreeContainsId(node, activeArticleId) : false
  const [open, setOpen] = useState(containsActive || depth < 1)

  const slugPath = getFullSlugPath(node, allArticles)
  const href = `${basePath}/${slugPath}`
  const active = activeArticleId === node.id

  return (
    <li className={styles.treeItem}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {hasChildren ? (
          <button
            type='button'
            className={styles.treeToggle}
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen((v) => !v)}>
            {open ? '▾' : '▸'}
          </button>
        ) : null}
        {node.isCategory ? (
          <span className={styles.treeLink} data-active={active ? 'true' : 'false'}>
            {node.emoji ? <span aria-hidden>{node.emoji}</span> : null}
            <span>{node.title}</span>
          </span>
        ) : (
          <Link
            href={href}
            className={styles.treeLink}
            data-active={active ? 'true' : 'false'}
            prefetch={false}>
            {node.emoji ? <span aria-hidden>{node.emoji}</span> : null}
            <span>{node.title}</span>
          </Link>
        )}
      </div>
      {hasChildren && open ? (
        <ul className={styles.treeBranch}>
          {node.children.map((child) => (
            <TreeBranch
              key={child.id}
              node={child}
              allArticles={allArticles}
              basePath={basePath}
              activeArticleId={activeArticleId}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
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
