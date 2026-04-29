// apps/web/src/components/kb/ui/editor/article-rename-dialog.tsx
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
import { EmojiPicker } from '@auxx/ui/components/emoji-picker'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { useEffect, useState } from 'react'

interface ArticleRenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  article: { id: string; title: string; emoji?: string | null; slug: string }
  onSubmit: (values: { title: string; emoji: string | null; slug?: string }) => Promise<void>
}

function toSlug(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function ArticleRenameDialog({
  open,
  onOpenChange,
  article,
  onSubmit,
}: ArticleRenameDialogProps) {
  const [emoji, setEmoji] = useState<string | null>(article.emoji ?? null)
  const [title, setTitle] = useState(article.title)
  const [slug, setSlug] = useState(article.slug)
  const [isLoading, setIsLoading] = useState(false)

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
      className='flex size-7.5 items-center justify-center rounded-full border bg-background text-lg leading-none hover:bg-muted'
      disabled={isLoading}>
      {emoji || '📄'}
    </button>
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return
    setIsLoading(true)
    try {
      await onSubmit({ title: title.trim(), emoji, slug: slug.trim() || undefined })
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to rename article:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Rename Article</DialogTitle>
          <DialogDescription>Update the article title, emoji, and slug.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup className='gap-4'>
            <div className='grid grid-cols-[30px_1fr] gap-2 items-end'>
              <Field>
                <FieldLabel className='sr-only'>Emoji</FieldLabel>
                <EmojiPicker value={emoji ?? undefined} onChange={setEmoji} modal={false}>
                  {trigger}
                </EmojiPicker>
              </Field>

              <Field>
                <FieldLabel>Title</FieldLabel>
                <Input
                  placeholder='Article title'
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isLoading}
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
                  disabled={isLoading}
                  autoComplete='off'
                />
              </InputGroup>
              <FieldDescription>The URL-friendly identifier for this article.</FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() => onOpenChange(false)}
              disabled={isLoading}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              type='submit'
              variant='outline'
              size='sm'
              disabled={!isValid || isLoading}
              loading={isLoading}
              loadingText='Saving...'>
              Save Changes <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
