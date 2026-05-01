// apps/web/src/components/kb/ui/editor/article-publish-cluster.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { ButtonGroup, ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { Archive, ArchiveRestore, ChevronDown, History, Send, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useArticleMutations } from '../../hooks/use-article-mutations'
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

export function ArticlePublishCluster({ article, knowledgeBaseId }: ArticlePublishClusterProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isVersionsOpen, setIsVersionsOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

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

  const dotClass = isArchived
    ? 'bg-muted-foreground'
    : isPublished
      ? hasUnsaved
        ? 'bg-amber-500'
        : 'bg-emerald-500'
      : 'bg-muted-foreground'
  const pillLabel = isArchived ? 'Archived' : isPublished ? 'Live' : 'Draft'

  const handlePublishChanges = async () => {
    await requestPublish(article)
  }

  const handlePublishDraft = async () => {
    await requestPublish(article)
  }

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

  const handleUnpublish = async () => {
    await requestUnpublish(article)
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

  const handleUnarchive = async () => {
    await unarchiveArticle(article.id)
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

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <ButtonGroup>
          <Button
            size='xs'
            variant='outline'
            className='gap-2 border-r-0'
            onClick={() => setIsMenuOpen((prev) => !prev)}>
            <span className={cn('inline-block size-2 rounded-full', dotClass)} />
            {pillLabel}
          </Button>

          {isPublished && hasUnsaved && (
            <>
              <ButtonGroupSeparator />
              <Button
                size='xs'
                variant='outline'
                className='border-r-0'
                onClick={handlePublishChanges}>
                <Send /> Publish changes
              </Button>
              <ButtonGroupSeparator />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size='xs'
                    variant='outline'
                    className='border-r-0 px-1.5'
                    onClick={handleDiscard}
                    aria-label='Discard changes'>
                    <Undo2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Discard changes</TooltipContent>
              </Tooltip>
            </>
          )}

          {isDraft && (
            <>
              <ButtonGroupSeparator />
              <Button
                size='xs'
                variant='outline'
                className='border-r-0'
                onClick={handlePublishDraft}>
                <Send /> Publish {noun}
              </Button>
            </>
          )}

          <ButtonGroupSeparator />
          <DropdownMenuTrigger asChild>
            <Button size='xs' variant='outline' className='px-1.5' aria-label='Publish menu'>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
        </ButtonGroup>

        <DropdownMenuContent align='end' className='w-56'>
          <DropdownMenuItem onClick={() => setIsVersionsOpen(true)}>
            <History /> Version history
          </DropdownMenuItem>
          {isPublished && (
            <>
              <DropdownMenuItem onClick={handleUnpublish}>
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
            <DropdownMenuItem onClick={handleUnarchive}>
              <ArchiveRestore /> Unarchive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleDelete} variant='destructive'>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
