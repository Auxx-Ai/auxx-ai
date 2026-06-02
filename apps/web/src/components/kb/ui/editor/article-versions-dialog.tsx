// apps/web/src/components/kb/ui/editor/article-versions-dialog.tsx
'use client'

import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { getFullSlugPath } from '@auxx/ui/components/kb'
import { getKbPreviewHref } from '@auxx/ui/components/kb/utils'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { ExternalLink, GitCompare, Loader2, Pencil, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { useDiffParam } from '../../hooks/use-diff-param'

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
  const [, setDiff] = useDiffParam()

  const handleDiff = (versionId: string) => {
    setDiff(`v:${versionId}`)
    onOpenChange(false)
  }

  const versionsQuery = api.kb.getArticleVersions.useQuery({ articleId }, { enabled: open })
  const article = api.kb.getArticleById.useQuery(
    { id: articleId, knowledgeBaseId },
    { enabled: open }
  )

  const articles = useArticleList(knowledgeBaseId)
  const slugPath = (() => {
    const a = articles.find((x) => x.id === articleId)
    return a ? getFullSlugPath(a, articles) : ''
  })()

  const renameMutation = api.kb.renameArticleVersion.useMutation()
  const [editingId, setEditingId] = useState<string | null>(null)

  const versions = versionsQuery.data ?? []
  const currentPublishedRevisionId = article.data?.publishedRevisionId ?? null

  const startRename = (versionId: string) => setEditingId(versionId)
  const cancelRename = () => setEditingId(null)
  const saveLabel = async (versionId: string, label: string | null) => {
    setEditingId(null)
    try {
      await renameMutation.mutateAsync({ versionId, label: label?.trim() || null })
      utils.kb.getArticleVersions.invalidate({ articleId })
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
        <DialogContent size='md' position='tc' innerClassName='pr-1'>
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              Each publish creates an immutable snapshot. Restore loads the snapshot into your
              draft; publishing the draft creates a new version.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className='max-h-[60vh]' scrollbarClassName='w-1'>
            {versionsQuery.isLoading ? (
              <div className='flex justify-center py-12'>
                <Loader2 className='size-5 animate-spin text-muted-foreground' />
              </div>
            ) : versions.length === 0 ? (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                No published versions yet. Publish this article to create the first one.
              </p>
            ) : (
              <ul className='space-y-3 pr-4'>
                {versions.map((v) => {
                  const isCurrent = v.id === currentPublishedRevisionId
                  const isEditing = editingId === v.id
                  return (
                    <li
                      key={v.id}
                      className='rounded-2xl border px-3 pt-1 pb-2 transition-colors hover:border-primary/30'>
                      <div className='mb-3 flex items-center gap-2'>
                        <span
                          className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold inset-shadow-xs inset-shadow-black/20',
                            isCurrent
                              ? 'bg-emerald-500 text-white'
                              : 'bg-muted text-muted-foreground'
                          )}>
                          v{v.versionNumber}
                        </span>
                        <div className='min-w-0 flex-1'>
                          <h3 className='truncate text-sm font-semibold'>{v.title}</h3>
                          <p className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
                            <span className='truncate'>{v.editor?.name ?? 'System'}</span>
                            <span className='shrink-0'>&middot;</span>
                            <span className='shrink-0'>{relativeTime(v.createdAt)}</span>
                            {isCurrent && (
                              <span className='shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700'>
                                Current
                              </span>
                            )}
                          </p>
                        </div>
                        <div className='flex shrink-0 items-center gap-1'>
                          {v.versionNumber !== null && slugPath ? (
                            <Tooltip content='View this version'>
                              <Button size='icon-xs' variant='ghost' asChild>
                                <a
                                  href={getKbPreviewHref(knowledgeBaseId, slugPath, {
                                    versionNumber: v.versionNumber,
                                  })}
                                  target='_blank'
                                  rel='noopener'>
                                  <ExternalLink />
                                </a>
                              </Button>
                            </Tooltip>
                          ) : null}
                          {!isCurrent && (
                            <Tooltip content='Compare with current'>
                              <Button
                                size='icon-xs'
                                variant='ghost'
                                onClick={() => handleDiff(v.id)}>
                                <GitCompare />
                              </Button>
                            </Tooltip>
                          )}
                          {!isCurrent && (
                            <Tooltip content='Restore as draft'>
                              <Button
                                size='icon-xs'
                                variant='outline'
                                onClick={() => handleRestore(v.id, v.versionNumber)}>
                                <Undo2 />
                              </Button>
                            </Tooltip>
                          )}
                        </div>
                      </div>

                      <VersionLabelRow
                        label={v.label}
                        isEditing={isEditing}
                        isPending={renameMutation.isPending && editingId === v.id}
                        onStartEdit={() => startRename(v.id)}
                        onSave={(value) => saveLabel(v.id, value)}
                        onCancel={cancelRename}
                        onClear={() => saveLabel(v.id, null)}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}

interface VersionLabelRowProps {
  label: string | null
  isEditing: boolean
  isPending: boolean
  onStartEdit: () => void
  onSave: (value: string) => void
  onCancel: () => void
  onClear: () => void
}

/** TemplateFieldRow-style inline-editable label pill for a version. */
function VersionLabelRow({
  label,
  isEditing,
  isPending,
  onStartEdit,
  onSave,
  onCancel,
  onClear,
}: VersionLabelRowProps) {
  const inputRef = useRef<AutosizeInputRef>(null)
  const [editValue, setEditValue] = useState('')
  const hasLabel = label != null && label !== ''

  useEffect(() => {
    if (isEditing) {
      setEditValue(label ?? '')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isEditing, label])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSave(editValue)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <div
      onClick={!isEditing ? onStartEdit : undefined}
      className={cn(
        'group relative flex h-7 items-center gap-1 rounded-md bg-primary-100 px-2 transition-opacity',
        !isEditing && 'cursor-pointer',
        isPending && 'opacity-50'
      )}>
      {isEditing ? (
        <AutosizeInput
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => onSave(editValue)}
          onKeyDown={handleKeyDown}
          placeholder='e.g. pricing update'
          inputClassName='bg-transparent text-sm text-foreground outline-none'
          minWidth={40}
          maxWidth={240}
        />
      ) : hasLabel ? (
        <span className='truncate text-sm text-foreground'>{label}</span>
      ) : (
        <span className='text-sm text-muted-foreground'>Add label</span>
      )}

      {/* Actions — fade in on hover, always shown while editing */}
      <div
        className={cn(
          'absolute right-1 flex items-center gap-0.5 transition-opacity duration-150',
          isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}>
        {isEditing ? (
          <button
            type='button'
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onCancel()
            }}
            className='flex size-5.5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary-200 hover:text-foreground'>
            <X className='size-3' />
          </button>
        ) : (
          <>
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                onStartEdit()
              }}
              className='flex size-5.5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary-200 hover:text-foreground'>
              <Pencil className='size-3' />
            </button>
            {hasLabel && (
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  onClear()
                }}
                className='flex size-5.5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary-200 hover:text-foreground'>
                <Trash2 className='size-3' />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
