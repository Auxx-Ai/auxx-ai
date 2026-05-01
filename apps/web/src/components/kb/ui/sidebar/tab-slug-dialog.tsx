// apps/web/src/components/kb/ui/sidebar/tab-slug-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { useEffect, useState } from 'react'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'

interface TabSlugDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: ArticleMeta
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

export function TabSlugDialog({ open, onOpenChange, tab, knowledgeBaseId }: TabSlugDialogProps) {
  const { renameArticle } = useArticleMutations(knowledgeBaseId)
  const [slug, setSlug] = useState(tab.slug)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setSlug(tab.slug)
      setIsSaving(false)
    }
  }, [open, tab.slug])

  const trimmed = slug.trim()
  const canSave = trimmed.length > 0 && trimmed !== tab.slug && !isSaving

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setIsSaving(true)
    try {
      await renameArticle(tab.id, { slug: trimmed })
      onOpenChange(false)
    } catch {
      // Toast already fired in the hook. Keep dialog open so user can adjust.
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Update slug</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave}>
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
                autoFocus
              />
            </InputGroup>
            <FieldDescription>
              The URL-friendly identifier for this tab. Changing it updates every descendant URL.
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => onOpenChange(false)}
              disabled={isSaving}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              type='submit'
              variant='outline'
              size='sm'
              disabled={!canSave}
              loading={isSaving}
              loadingText='Saving...'>
              Save <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
