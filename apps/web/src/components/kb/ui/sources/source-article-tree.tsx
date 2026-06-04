// apps/web/src/components/kb/ui/sources/source-article-tree.tsx
'use client'

import type { ArticleKind } from '@auxx/database/types'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Book, FileText, FolderClosed, Heading, Link2, Loader2 } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useState } from 'react'
import { useIsArticleListLoaded } from '../../hooks/use-article-list'
import { useArticleTree } from '../../hooks/use-article-tree'
import type { ArticleTreeNode } from '../../store/article-store'
import type { KnowledgeSource } from './sources-provider'

const KIND_ICON: Record<ArticleKind, typeof FileText> = {
  page: FileText,
  category: FolderClosed,
  header: Heading,
  tab: Book,
  link: Link2,
}

/** Drop archived nodes recursively — the source view only browses live content. */
function stripArchived(nodes: ArticleTreeNode[]): ArticleTreeNode[] {
  return nodes
    .filter((n) => n.status !== 'ARCHIVED')
    .map((n) => ({ ...n, children: stripArchived(n.children) }))
}

/**
 * Read-only article tree for the source workspace's **Articles** tab. Mirrors the
 * KB sidebar tree's shape but without drag-and-drop, mutations, or routing —
 * selecting a row writes the article id to the `?article` query param, which the
 * right pane reads to render the (read-only, source-managed) editor.
 */
export function SourceArticleTree({ source }: { source: KnowledgeSource }) {
  const kbId = source.ownedKnowledgeBaseId
  const tree = useArticleTree(kbId)
  const loaded = useIsArticleListLoaded(kbId)
  const [selectedId, setSelectedId] = useQueryState('article', parseAsString)
  const [openStates, setOpenStates] = useState<Record<string, boolean>>({})

  const visible = stripArchived(tree)

  if (!loaded) {
    return (
      <div className='flex flex-1 items-center justify-center py-8'>
        <Loader2 className='size-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  if (visible.length === 0) {
    return (
      <p className='p-4 text-sm text-muted-foreground'>
        No articles yet. Run a sync to ingest content.
      </p>
    )
  }

  const toggleOpen = (id: string) => setOpenStates((prev) => ({ ...prev, [id]: !prev[id] }))

  const renderNode = (node: ArticleTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0
    const isOpen = openStates[node.id] ?? false
    const Icon = KIND_ICON[node.articleKind] ?? FileText
    return (
      <TreeRow
        key={node.id}
        depth={depth}
        icon={<Icon className='size-4 text-muted-foreground' />}
        title={node.title || 'Untitled'}
        onTitleClick={() => void setSelectedId(node.id)}
        expandable={hasChildren}
        isOpen={isOpen}
        onToggleOpen={() => toggleOpen(node.id)}
        rowClassName={cn('hover:bg-muted/50', selectedId === node.id && 'bg-muted')}>
        {hasChildren ? node.children.map((child) => renderNode(child, depth + 1)) : undefined}
      </TreeRow>
    )
  }

  return (
    <ScrollArea className='flex min-h-0 flex-1 flex-col pt-3'>
      <div className='flex flex-col gap-0.5 p-1'>{visible.map((node) => renderNode(node, 0))}</div>
    </ScrollArea>
  )
}
