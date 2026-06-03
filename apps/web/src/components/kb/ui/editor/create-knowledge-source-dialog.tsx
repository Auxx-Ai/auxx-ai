// apps/web/src/components/kb/ui/editor/create-knowledge-source-dialog.tsx
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
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

interface CreateKnowledgeSourceDialogProps {
  /** Target KB — the source's articles home here. */
  knowledgeBaseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ItemRow {
  /** Stable React key — rows are removable, so index keys would mis-associate state. */
  key: string
  title: string
  externalId: string
  markdown: string
}

let rowKeySeq = 0
const emptyRow = (): ItemRow => ({
  key: `row-${rowKeySeq++}`,
  title: '',
  externalId: '',
  markdown: '',
})

/** Stable, normalized key from a title (fallback when externalId is left blank). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Minimal manual-source form (Phase 1). Name + paste rows → create a manual
 * KnowledgeSource targeting the current KB, then trigger a sync. The full
 * Sources tab/wizard is a later phase (see plans/kb/sources/ui-sources.md).
 */
export function CreateKnowledgeSourceDialog({
  knowledgeBaseId,
  open,
  onOpenChange,
}: CreateKnowledgeSourceDialogProps) {
  const [name, setName] = useState('')
  const [rows, setRows] = useState<ItemRow[]>([emptyRow()])
  const utils = api.useUtils()
  const createSource = api.knowledgeSource.create.useMutation()
  const syncNow = api.knowledgeSource.syncNow.useMutation()
  const isSubmitting = createSource.isPending || syncNow.isPending

  const reset = () => {
    setName('')
    setRows([emptyRow()])
  }

  const updateRow = (index: number, patch: Partial<ItemRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  const addRow = () => setRows((prev) => [...prev, emptyRow()])
  const removeRow = (index: number) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)))

  const handleSubmit = async () => {
    const trimmedName = name.trim()
    const items = rows
      .map((row, i) => ({
        title: row.title.trim(),
        markdown: row.markdown.trim(),
        externalId: row.externalId.trim() || slugify(row.title) || `item-${i + 1}`,
      }))
      .filter((item) => item.title && item.markdown)

    if (!trimmedName) {
      toastError({ title: 'Name required', description: 'Give the source a name.' })
      return
    }
    if (items.length === 0) {
      toastError({
        title: 'Add at least one item',
        description: 'Each item needs a title and markdown body.',
      })
      return
    }
    const ids = new Set(items.map((i) => i.externalId))
    if (ids.size !== items.length) {
      toastError({
        title: 'Duplicate item keys',
        description: 'Each item needs a unique external id (or a unique title).',
      })
      return
    }

    try {
      const source = await createSource.mutateAsync({
        name: trimmedName,
        type: 'manual',
        targetKnowledgeBaseId: knowledgeBaseId,
        surface: 'publishable',
        config: { items },
      })
      await syncNow.mutateAsync({ id: source.id })
      // The sync runs in the background worker; nudge the sidebar to pick up the
      // new managed articles once it lands.
      void utils.kb.getArticles.invalidate({ knowledgeBaseId })
      void utils.knowledgeSource.list.invalidate()
      onOpenChange(false)
      reset()
    } catch (error) {
      toastError({
        title: "Couldn't create source",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>New manual source</DialogTitle>
          <DialogDescription>
            Paste content as items. Each becomes a locked, source-managed article in this knowledge
            base. Re-syncing overwrites managed articles; detach one to edit it.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='source-name'>Source name</Label>
            <Input
              id='source-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. Help center export'
            />
          </div>

          <div className='flex flex-col gap-3'>
            {rows.map((row, index) => (
              <div key={row.key} className='flex flex-col gap-2 rounded-md border p-3'>
                <div className='flex items-center gap-2'>
                  <Input
                    value={row.title}
                    onChange={(e) => updateRow(index, { title: e.target.value })}
                    placeholder='Item title'
                  />
                  <Input
                    value={row.externalId}
                    onChange={(e) => updateRow(index, { externalId: e.target.value })}
                    placeholder='External id (optional)'
                    className='max-w-[200px]'
                  />
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() => removeRow(index)}
                    disabled={rows.length === 1}
                    aria-label='Remove item'>
                    <Trash2 />
                  </Button>
                </div>
                <Textarea
                  value={row.markdown}
                  onChange={(e) => updateRow(index, { markdown: e.target.value })}
                  placeholder='# Markdown body'
                  rows={5}
                  className='font-mono text-sm'
                />
              </div>
            ))}
            <Button variant='outline' size='sm' className='self-start' onClick={addRow}>
              <Plus /> Add item
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isSubmitting} loadingText='Creating...'>
            Create & sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
