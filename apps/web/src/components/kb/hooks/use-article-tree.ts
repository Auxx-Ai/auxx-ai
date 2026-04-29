// apps/web/src/components/kb/hooks/use-article-tree.ts
'use client'

import { buildArticleTree } from '@auxx/ui/components/kb/utils'
import { useMemo } from 'react'
import type { ArticleTreeNode } from '../store/article-store'
import { useArticleList } from './use-article-list'

/**
 * Build a hierarchical tree from the flat article list for a KB.
 * Memoized — recomputes only when the flat list reference changes.
 */
export function useArticleTree(knowledgeBaseId: string | null | undefined): ArticleTreeNode[] {
  const flat = useArticleList(knowledgeBaseId)
  return useMemo(() => buildArticleTree(flat) as ArticleTreeNode[], [flat])
}
