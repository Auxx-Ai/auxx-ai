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
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { ChevronsUpDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'
import { ArticleMovePicker } from '../articles/article-move-picker'

interface ArticleSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  article: ArticleMeta
  knowledgeBaseId: string
}

function sanitizeSlugInput(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
}

function normalizeSlug(str: string): string {
  return str.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
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
  const [isMoveOpen, setIsMoveOpen] = useState(false)
  const articles = useArticleList(knowledgeBaseId)
  const utils = api.useUtils()
  const moveArticle = api.kb.moveArticle.useMutation()

  const locationLabel = useMemo(() => {
    if (!article.parentId) return 'Root'
    const chain: string[] = []
    let cursor: ArticleMeta | undefined = articles.find((a) => a.id === article.parentId)
    while (cursor) {
      chain.unshift(cursor.title || 'Untitled')
      cursor = cursor.parentId ? articles.find((a) => a.id === cursor!.parentId) : undefined
    }
    return chain.join(' / ') || 'Root'
  }, [article.parentId, articles])

  const { renameArticle } = useArticleMutations(knowledgeBaseId)

  useEffect(() => {
    if (open) {
      setEmoji(article.emoji ?? null)
      setTitle(article.title)
      setSlug(article.slug)
    }
  }, [open, article])

  const isValid = title.trim().length > 0

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
    const cleanSlug = normalizeSlug(slug)
    try {
      await renameArticle(article.id, {
        title: title.trim(),
        emoji,
        slug: cleanSlug || undefined,
      })
      onOpenChange(false)
    } catch {
      // Toast already fired in the hook. Keep dialog open so user can adjust.
    } finally {
      setIsSaving(false)
    }
  }

  const handleMove = async (parentId: string) => {
    setIsMoveOpen(false)
    try {
      await moveArticle.mutateAsync({
        knowledgeBaseId,
        id: article.id,
        parentId,
      })
      utils.kb.getArticles.invalidate({ knowledgeBaseId })
      toastSuccess({ title: 'Moved', description: 'Article relocated.' })
    } catch (err) {
      toastError({
        title: 'Move failed',
        description: err instanceof Error ? err.message : 'Could not move article.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='md' position='tc'>
        <DialogHeader>
          <DialogTitle>Page settings</DialogTitle>
          <DialogDescription className='sr-only'>Edit identity for this article.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className='space-y-6'>
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
                    onChange={(e) => setSlug(sanitizeSlugInput(e.target.value))}
                    onBlur={() => setSlug((s) => normalizeSlug(s))}
                    disabled={isSaving}
                    autoComplete='off'
                  />
                </InputGroup>
                <FieldDescription>The URL-friendly identifier for this article.</FieldDescription>
              </Field>
              {article.articleKind !== 'tab' && (
                <Field>
                  <FieldLabel>Location</FieldLabel>
                  <Popover open={isMoveOpen} onOpenChange={setIsMoveOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type='button'
                        variant='outline'
                        className='justify-between font-normal'
                        disabled={isSaving}>
                        <span className='truncate'>{locationLabel}</span>
                        <ChevronsUpDown className='size-4 opacity-50' />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align='start' className='w-72 p-0'>
                      <ArticleMovePicker
                        knowledgeBaseId={knowledgeBaseId}
                        articleId={article.id}
                        currentParentId={article.parentId}
                        onPick={handleMove}
                        onClose={() => setIsMoveOpen(false)}
                      />
                    </PopoverContent>
                  </Popover>
                  <FieldDescription>
                    Move this article to a different tab or category.
                  </FieldDescription>
                </Field>
              )}
            </section>
          </div>

          <DialogFooter className='mt-6'>
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
