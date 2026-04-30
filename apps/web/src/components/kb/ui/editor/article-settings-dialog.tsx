// apps/web/src/components/kb/ui/editor/article-settings-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { IconPicker } from '@auxx/ui/components/icon-picker'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Switch } from '@auxx/ui/components/switch'
import { Archive, History, House, RotateCcw, Send, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'
import { ArticleStatusPill, articleStatusDescription } from './article-status-pill'
import { ArticleVersionsDialog } from './article-versions-dialog'

interface ArticleSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  article: ArticleMeta
  knowledgeBaseId: string
}

function toSlug(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function ArticleSettingsDialog({
  open,
  onOpenChange,
  article,
  knowledgeBaseId,
}: ArticleSettingsDialogProps) {
  const [emoji, setEmoji] = useState<string | null>(article.emoji ?? null)
  const [title, setTitle] = useState(article.title)
  const [slug, setSlug] = useState(article.slug)
  const [isSaving, setIsSaving] = useState(false)
  const [isVersionsOpen, setIsVersionsOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  const {
    renameArticle,
    publishArticle,
    unpublishArticle,
    archiveArticle,
    unarchiveArticle,
    discardArticleDraft,
    setHomeArticle,
    deleteArticle,
  } = useArticleMutations(knowledgeBaseId)

  useEffect(() => {
    if (open) {
      setEmoji(article.emoji ?? null)
      setTitle(article.title)
      setSlug(article.slug)
    }
  }, [open, article])

  const isValid = title.trim().length > 0
  const isArchived = article.status === 'ARCHIVED'
  const isPublished = article.isPublished && !isArchived
  const isDraft = !article.isPublished && !isArchived
  const hasUnsaved = !!article.hasUnpublishedChanges

  const trigger = (
    <button
      type='button'
      className='flex size-7.5 items-center justify-center rounded-full border bg-background hover:bg-muted'
      disabled={isSaving}>
      <EntityIcon
        iconId={emoji ?? 'file-text'}
        variant='bare'
        size='sm'
        className={emoji ? '' : 'text-muted-foreground'}
      />
    </button>
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return
    setIsSaving(true)
    try {
      await renameArticle(article.id, {
        title: title.trim(),
        emoji,
        slug: slug.trim() || undefined,
      })
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handlePublish = async () => {
    await publishArticle(article.id)
    onOpenChange(false)
  }
  const handleUnpublish = async () => {
    const ok = await confirm({
      title: 'Unpublish article?',
      description:
        'The article will be removed from the public site. The published version is kept and can be republished later.',
      confirmText: 'Unpublish',
      cancelText: 'Cancel',
    })
    if (!ok) return
    await unpublishArticle(article.id)
    onOpenChange(false)
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
    onOpenChange(false)
  }
  const handleUnarchive = async () => {
    await unarchiveArticle(article.id)
    onOpenChange(false)
  }
  const handleDiscardDraft = async () => {
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
    onOpenChange(false)
  }
  const handleToggleHome = async () => {
    if (article.isHomePage) return
    await setHomeArticle(article.id)
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
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size='md' position='tc'>
          <DialogHeader>
            <div className='flex items-center justify-between gap-3 pr-8'>
              <DialogTitle className='flex items-center gap-3'>
                <span>Page settings</span>
                <div className='flex items-center gap-2 min-w-0'>
                  <ArticleStatusPill article={article} />
                  <span className='text-xs text-muted-foreground truncate'>
                    {articleStatusDescription(article)}
                  </span>
                </div>
              </DialogTitle>
            </div>
            <DialogDescription className='sr-only'>
              Edit identity, visibility, and version history for this article.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit}>
            <div className='space-y-6'>
              {/* Identity */}
              <section className='space-y-3'>
                <div className='grid grid-cols-[30px_1fr] items-end gap-2'>
                  <Field>
                    <FieldLabel className='sr-only'>Icon</FieldLabel>
                    <IconPicker
                      value={emoji ? { icon: emoji, color: 'gray' } : undefined}
                      onChange={(v) => setEmoji(v.icon)}
                      hideColors
                      modal={false}>
                      {trigger}
                    </IconPicker>
                  </Field>
                  <Field>
                    <FieldLabel>Title</FieldLabel>
                    <Input
                      placeholder='Article title'
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      disabled={isSaving}
                      autoComplete='off'
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel>Slug</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon align='inline-start'>
                      <InputGroupText>/</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      placeholder='article-slug'
                      value={slug}
                      onChange={(e) => setSlug(toSlug(e.target.value))}
                      disabled={isSaving}
                      autoComplete='off'
                    />
                  </InputGroup>
                  <FieldDescription>The URL-friendly identifier for this article.</FieldDescription>
                </Field>
              </section>

              {/* Visibility & publish */}
              <section className='space-y-3'>
                <h3 className='text-sm font-medium'>Visibility & publish</h3>
                <div className='flex flex-wrap gap-2'>
                  {isDraft && (
                    <Button type='button' variant='info' size='sm' onClick={handlePublish}>
                      <Send /> Publish article
                    </Button>
                  )}
                  {isPublished && hasUnsaved && (
                    <Button type='button' variant='info' size='sm' onClick={handlePublish}>
                      <Send /> Publish changes
                    </Button>
                  )}
                  {isPublished && hasUnsaved && (
                    <Button type='button' variant='outline' size='sm' onClick={handleDiscardDraft}>
                      <Undo2 /> Discard draft
                    </Button>
                  )}
                  {isPublished && (
                    <Button type='button' variant='outline' size='sm' onClick={handleUnpublish}>
                      <RotateCcw /> Unpublish
                    </Button>
                  )}
                  {(isPublished || isDraft) && (
                    <Button type='button' variant='outline' size='sm' onClick={handleArchive}>
                      <Archive /> Archive
                    </Button>
                  )}
                  {isArchived && (
                    <Button type='button' variant='info' size='sm' onClick={handleUnarchive}>
                      <RotateCcw /> Unarchive
                    </Button>
                  )}
                </div>
              </section>

              {/* Home page */}
              {isPublished && !article.isCategory && (
                <section className='flex items-center justify-between gap-4'>
                  <div className='space-y-0.5'>
                    <h3 className='text-sm font-medium flex items-center gap-2'>
                      <House className='size-4' /> Home page
                    </h3>
                    <p className='text-xs text-muted-foreground'>
                      Use this article as the landing page of the knowledge base.
                    </p>
                  </div>
                  <Switch
                    checked={article.isHomePage}
                    disabled={article.isHomePage}
                    onCheckedChange={() => handleToggleHome()}
                  />
                </section>
              )}

              {/* Version history */}
              <section className='flex items-center justify-between gap-4'>
                <div className='space-y-0.5'>
                  <h3 className='text-sm font-medium flex items-center gap-2'>
                    <History className='size-4' /> Version history
                  </h3>
                  <p className='text-xs text-muted-foreground'>
                    View, restore, or label prior published versions.
                  </p>
                </div>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setIsVersionsOpen(true)}>
                  View history
                </Button>
              </section>
            </div>

            <DialogFooter className='mt-6 sm:justify-between'>
              <Button
                type='button'
                size='sm'
                variant='destructive-hover'
                onClick={handleDelete}
                disabled={isSaving}>
                <Trash2 /> Delete
              </Button>
              <div className='flex flex-col-reverse sm:flex-row sm:space-x-2'>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={() => onOpenChange(false)}
                  disabled={isSaving}>
                  Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
                </Button>
                <Button
                  type='submit'
                  variant='outline'
                  size='sm'
                  disabled={!isValid || isSaving}
                  loading={isSaving}
                  loadingText='Saving...'>
                  Save changes <KbdSubmit variant='outline' size='sm' />
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ArticleVersionsDialog
        open={isVersionsOpen}
        onOpenChange={setIsVersionsOpen}
        articleId={article.id}
        knowledgeBaseId={knowledgeBaseId}
      />
      {ConfirmDialog}
    </>
  )
}
