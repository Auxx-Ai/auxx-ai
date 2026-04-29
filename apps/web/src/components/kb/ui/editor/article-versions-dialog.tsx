// apps/web/src/components/kb/ui/editor/article-versions-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Check, Loader2, Pencil, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useArticleMutations } from '../../hooks/use-article-mutations'

interface ArticleVersionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  articleId: string
  knowledgeBaseId: string
}

function relativeTime(date: Date | string): string {
  const ts = typeof date === 'string' ? new Date(date) : date
  const diff = Date.now() - ts.getTime()
  const sec = Math.round(diff / 1000)
  const min = Math.round(sec / 60)
  const hr = Math.round(min / 60)
  const day = Math.round(hr / 24)
  if (sec < 60) return 'just now'
  if (min < 60) return `${min}m ago`
  if (hr < 24) return `${hr}h ago`
  if (day < 7) return `${day}d ago`
  return ts.toLocaleDateString()
}

export function ArticleVersionsDialog({
  open,
  onOpenChange,
  articleId,
  knowledgeBaseId,
}: ArticleVersionsDialogProps) {
  const utils = api.useUtils()
  const { restoreArticleVersion } = useArticleMutations(knowledgeBaseId)
  const [confirm, ConfirmDialog] = useConfirm()

  const versionsQuery = api.kb.getArticleVersions.useQuery({ articleId }, { enabled: open })
  const article = api.kb.getArticleById.useQuery(
    { id: articleId, knowledgeBaseId },
    { enabled: open }
  )

  const renameMutation = api.kb.renameArticleVersion.useMutation()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  const versions = versionsQuery.data ?? []
  const currentPublishedRevisionId = article.data?.publishedRevisionId ?? null

  const startRename = (versionId: string, currentLabel: string | null) => {
    setEditingId(versionId)
    setEditingLabel(currentLabel ?? '')
  }
  const cancelRename = () => {
    setEditingId(null)
    setEditingLabel('')
  }
  const submitRename = async (versionId: string) => {
    try {
      await renameMutation.mutateAsync({
        versionId,
        label: editingLabel.trim() || null,
      })
      utils.kb.getArticleVersions.invalidate({ articleId })
      cancelRename()
    } catch (error) {
      toastError({
        title: 'Failed to rename version',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  const handleRestore = async (versionId: string, versionNumber: number | null) => {
    const ok = await confirm({
      title: `Restore v${versionNumber} as draft?`,
      description:
        'Your current draft will be replaced with this version’s content. Click Publish from the editor to make it live.',
      confirmText: 'Restore as draft',
      cancelText: 'Cancel',
    })
    if (!ok) return
    await restoreArticleVersion(versionId)
    toastSuccess({ title: 'Version loaded into draft' })
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size='md' position='tc'>
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              Each publish creates an immutable snapshot. Restore loads the snapshot into your
              draft; publishing the draft creates a new version.
            </DialogDescription>
          </DialogHeader>

          <div className='max-h-[60vh] overflow-y-auto'>
            {versionsQuery.isLoading ? (
              <div className='flex justify-center py-12'>
                <Loader2 className='size-5 animate-spin text-muted-foreground' />
              </div>
            ) : versions.length === 0 ? (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                No published versions yet. Publish this article to create the first one.
              </p>
            ) : (
              <ul className='space-y-3'>
                {versions.map((v) => {
                  const isCurrent = v.id === currentPublishedRevisionId
                  const isEditing = editingId === v.id
                  return (
                    <li key={v.id} className='rounded-md border p-3 hover:border-primary/30'>
                      <div className='flex items-center justify-between gap-2'>
                        <div className='flex items-center gap-2'>
                          <span
                            className={
                              isCurrent
                                ? 'inline-flex size-2 rounded-full bg-emerald-500'
                                : 'inline-flex size-2 rounded-full bg-muted-foreground/40'
                            }
                          />
                          <span className='text-sm font-medium'>v{v.versionNumber}</span>
                          {isCurrent && (
                            <span className='rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700'>
                              Current
                            </span>
                          )}
                        </div>
                        <span className='text-xs text-muted-foreground'>
                          {relativeTime(v.createdAt)}
                        </span>
                      </div>
                      <div className='mt-1 text-sm'>{v.title}</div>
                      {isEditing ? (
                        <div className='mt-2 flex items-center gap-2'>
                          <Input
                            autoFocus
                            value={editingLabel}
                            onChange={(e) => setEditingLabel(e.target.value)}
                            placeholder='e.g. v2 — pricing update'
                            className='h-7 text-xs'
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitRename(v.id)
                              if (e.key === 'Escape') cancelRename()
                            }}
                          />
                          <Button
                            size='icon-xs'
                            variant='outline'
                            onClick={() => submitRename(v.id)}
                            disabled={renameMutation.isPending}>
                            <Check />
                          </Button>
                          <Button size='icon-xs' variant='ghost' onClick={cancelRename}>
                            <X />
                          </Button>
                        </div>
                      ) : v.label ? (
                        <div className='mt-1 flex items-center gap-2 text-xs italic text-muted-foreground'>
                          “{v.label}”
                          <button
                            type='button'
                            className='opacity-60 hover:opacity-100'
                            onClick={() => startRename(v.id, v.label)}>
                            <Pencil className='size-3' />
                          </button>
                        </div>
                      ) : (
                        <button
                          type='button'
                          className='mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
                          onClick={() => startRename(v.id, v.label)}>
                          <Pencil className='size-3' /> Add label
                        </button>
                      )}
                      <div className='mt-3 flex items-center gap-2'>
                        <span className='flex-1 text-xs text-muted-foreground'>
                          {v.editor?.name ?? 'System'}
                        </span>
                        {!isCurrent && (
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => handleRestore(v.id, v.versionNumber)}>
                            <Undo2 /> Restore as draft
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {ConfirmDialog}
    </>
  )
}
