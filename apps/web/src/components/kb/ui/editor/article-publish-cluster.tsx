// apps/web/src/components/kb/ui/editor/article-publish-cluster.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { Archive, ArchiveRestore, GitCompare, History, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { PublishClusterShell } from '~/components/versioning/ui/publish-cluster-shell'
import { useConfirm } from '~/hooks/use-confirm'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { useDiffParam } from '../../hooks/use-diff-param'
import { usePublishWithConfirm } from '../../hooks/use-publish-with-confirm'
import type { ArticleMeta } from '../../store/article-store'
import { ArticleVersionsDialog } from './article-versions-dialog'

interface ArticlePublishClusterProps {
  article: ArticleMeta
  knowledgeBaseId: string
}

function kindNoun(kind: ArticleMeta['articleKind']): string {
  if (kind === ArticleKind.tab) return 'tab'
  if (kind === ArticleKind.header || kind === ArticleKind.category) return 'category'
  return 'page'
}

/**
 * Article publish cluster — a {@link PublishClusterShell} consumer with the
 * richest slot content (the proof the shared API is sufficient): the four-state
 * pill incl. Archived, a review-diff `extraSegments` button, and a full
 * unpublish/archive/unarchive/delete menu. `usePublishWithConfirm` stays here.
 * See plans/agents/agent-versions/ui-plan.md §3.2.
 */
export function ArticlePublishCluster({ article, knowledgeBaseId }: ArticlePublishClusterProps) {
  const [isVersionsOpen, setIsVersionsOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const [, setDiff] = useDiffParam()

  const { archiveArticle, unarchiveArticle, discardArticleDraft, deleteArticle } =
    useArticleMutations(knowledgeBaseId)
  const {
    requestPublish,
    requestUnpublish,
    ConfirmDialog: PublishConfirmDialog,
  } = usePublishWithConfirm(knowledgeBaseId)

  const isArchived = article.status === 'ARCHIVED'
  const isPublished = article.isPublished && !isArchived
  const isDraft = !article.isPublished && !isArchived
  const hasUnsaved = !!article.hasUnpublishedChanges
  const noun = kindNoun(article.articleKind)

  const handleDiscard = async () => {
    const ok = await confirm({
      title: 'Discard unsaved changes?',
      description:
        'Your draft edits will be replaced with the currently published version. This cannot be undone.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await discardArticleDraft(article.id)
  }

  const handleArchive = async () => {
    const ok = await confirm({
      title: 'Archive article?',
      description: 'The article will be hidden from the sidebar and the public site.',
      confirmText: 'Archive',
      cancelText: 'Cancel',
    })
    if (!ok) return
    await archiveArticle(article.id)
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete article?',
      description: 'This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await deleteArticle(article.id)
  }

  const reviewDiffSegment = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size='xs'
          variant='outline'
          className='border-r-0 px-1.5'
          onClick={() => setDiff('review')}
          aria-label='Review changes'>
          <GitCompare />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Review changes</TooltipContent>
    </Tooltip>
  )

  return (
    <>
      <PublishClusterShell
        status={{ isPublished, hasUnsaved, isArchived }}
        extraSegments={isPublished && hasUnsaved ? reviewDiffSegment : undefined}
        // Archived articles get no publish action; otherwise the same handler
        // serves draft publish and publish-changes, with a label per state.
        publish={
          isArchived
            ? undefined
            : {
                onClick: () => void requestPublish(article),
                label: isPublished ? 'Publish changes' : `Publish ${noun}`,
              }
        }
        discard={{ onClick: handleDiscard }}>
        <DropdownMenuItem onClick={() => setIsVersionsOpen(true)}>
          <History /> Version history
        </DropdownMenuItem>
        {isPublished && (
          <>
            <DropdownMenuItem onClick={() => void requestUnpublish(article)}>
              <Undo2 /> Unpublish
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleArchive}>
              <Archive /> Archive
            </DropdownMenuItem>
          </>
        )}
        {isDraft && (
          <DropdownMenuItem onClick={handleArchive}>
            <Archive /> Archive
          </DropdownMenuItem>
        )}
        {isArchived && (
          <DropdownMenuItem onClick={() => void unarchiveArticle(article.id)}>
            <ArchiveRestore /> Unarchive
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleDelete} variant='destructive'>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </PublishClusterShell>

      <ArticleVersionsDialog
        open={isVersionsOpen}
        onOpenChange={setIsVersionsOpen}
        articleId={article.id}
        knowledgeBaseId={knowledgeBaseId}
      />
      <ConfirmDialog />
      <PublishConfirmDialog />
    </>
  )
}
