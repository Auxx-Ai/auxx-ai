// apps/web/src/components/kb/ui/sidebar/pending-article-row.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import { getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { cn } from '@auxx/ui/lib/utils'
import { FileText, FolderClosed, Heading } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { usePendingInsertStore } from '../../store/pending-insert-store'
import { RenameInput } from './rename-input'

interface PendingArticleRowProps {
  articleKind: ArticleKindType
  parentId: string | null
  adjacentTo?: string
  position?: 'before' | 'after'
  knowledgeBaseId: string
}

/**
 * Inline "type the title to create" row. Mounted by `ArticleTreeSection` at
 * the location described by the pending-insert store. Mirrors the chrome of a
 * real article row (icon + indent are owned by the section wrapper) so the
 * user previews where the new article will land.
 *
 * Commit: hand the typed title to `createArticle` and clear pending; for
 * pages/categories navigate to the new article so the editor opens it.
 * Cancel (Escape, blur-empty): clear pending without a server call.
 */
export function PendingArticleRow({
  articleKind,
  parentId,
  adjacentTo,
  position,
  knowledgeBaseId,
}: PendingArticleRowProps) {
  const router = useRouter()
  const articles = useArticleList(knowledgeBaseId)
  const { createArticle } = useArticleMutations(knowledgeBaseId)
  const clearPending = usePendingInsertStore((s) => s.clearPending)
  const containerRef = useRef<HTMLDivElement>(null)
  const isHeader = articleKind === ArticleKind.header

  useEffect(() => {
    containerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const handleCommit = async (title: string) => {
    clearPending()
    const created = await createArticle({
      title,
      articleKind,
      parentId,
      adjacentTo,
      position,
    })
    if (created && articleKind !== ArticleKind.header) {
      const path = `/app/kb/${knowledgeBaseId}/editor/~/${getFullSlugPath(created, [...articles, created])}?panel=articles`
      router.push(path)
    }
  }

  const icon =
    articleKind === ArticleKind.category ? (
      <FolderClosed className='size-4 shrink-0 text-muted-foreground' />
    ) : isHeader ? (
      <Heading className='size-4 shrink-0 text-muted-foreground' />
    ) : (
      <FileText className='size-4 shrink-0 text-muted-foreground' />
    )

  return (
    <div ref={containerRef} className='relative'>
      <div
        className={cn(
          'relative flex items-center',
          isHeader
            ? 'pb-1 pt-3'
            : 'cursor-default rounded-md text-sm text-muted-foreground bg-background'
        )}>
        <div className='flex items-center px-1'>
          <span className='flex items-center size-4'>{icon}</span>
        </div>
        <div
          className={cn('flex flex-1 items-center', !isHeader && 'rounded-md px-2 py-2 text-sm')}>
          <RenameInput
            initialValue=''
            placeholder='Untitled'
            onCommit={(trimmed) => void handleCommit(trimmed)}
            onCancel={clearPending}
            inputClassName={cn(
              'rounded-sm bg-background px-1 outline-none ring-1 ring-primary',
              isHeader ? 'text-xs font-semibold uppercase tracking-wide' : 'text-sm'
            )}
            minWidth={80}
          />
        </div>
      </div>
    </div>
  )
}
