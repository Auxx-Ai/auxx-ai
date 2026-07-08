// apps/web/src/components/versioning/ui/version-history-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils'
import { Loader2, Trash2, Undo2 } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { VersionLabelRow } from './version-label-row'

/** One published version, as the dialog renders it. */
export interface VersionRowData {
  id: string
  versionNumber: number | null
  label: string | null
  /** Optional headline (e.g. an article title snapshot). Falls back to label, then `Version {n}`. */
  title?: string | null
  editorName?: string | null
  createdAt: string | Date
}

export interface VersionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  versions: VersionRowData[] | undefined
  isLoading: boolean
  currentVersionId: string | null
  /** Resolves the restore mutation; the dialog owns the confirm. Return false to keep it open. */
  onRestore: (version: VersionRowData) => Promise<boolean>
  /** Presence enables the inline {@link VersionLabelRow} on every row. */
  onRenameLabel?: (versionId: string, label: string | null) => Promise<void>
  /**
   * Presence enables a destructive delete action on every non-current row. The
   * dialog owns the confirm; return without throwing on success. The current
   * version never shows the control (and the server rejects deleting it anyway).
   */
  onDelete?: (version: VersionRowData) => Promise<boolean>
  /** Override the delete confirmation copy. */
  deleteConfirm?: (version: VersionRowData) => {
    title: string
    description: string
    confirmText?: string
    cancelText?: string
  }
  /** Per-row extra action icons (e.g. article preview link + content diff). */
  renderRowActions?: (version: VersionRowData, ctx: { isCurrent: boolean }) => React.ReactNode
  /**
   * Override the restore confirmation copy. Defaults to the "restore as draft"
   * wording; consumers that restore immediately (e.g. dashboards) pass their own.
   */
  restoreConfirm?: (version: VersionRowData) => {
    title: string
    description: string
    confirmText?: string
    cancelText?: string
  }
  emptyMessage?: string
}

/**
 * Generic version-history dialog — the third home for the KB-article design,
 * shared by agents, procedures, and articles. Data + callbacks in, zero tRPC
 * inside (adapters own the queries/mutations). Owns: the dialog shell, scroll
 * area, loading/empty states, row layout, the Current badge, the unified
 * restore-as-draft confirm, and the inline label editor when `onRenameLabel` is
 * passed. See plans/agents/agent-versions/ui-plan.md §1.1.
 */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  versions,
  isLoading,
  currentVersionId,
  onRestore,
  onRenameLabel,
  onDelete,
  deleteConfirm,
  renderRowActions,
  restoreConfirm,
  emptyMessage,
}: VersionHistoryDialogProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingRenameId, setPendingRenameId] = useState<string | null>(null)

  const rows = versions ?? []

  const saveLabel = async (versionId: string, label: string | null) => {
    setEditingId(null)
    if (!onRenameLabel) return
    setPendingRenameId(versionId)
    try {
      await onRenameLabel(versionId, label?.trim() || null)
    } catch (error) {
      toastError({
        title: 'Failed to rename version',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    } finally {
      setPendingRenameId(null)
    }
  }

  const handleRestore = async (version: VersionRowData) => {
    const copy = restoreConfirm?.(version) ?? {
      title: `Restore v${version.versionNumber} as draft?`,
      description:
        "Your current draft will be replaced with this version's content. Publish to make it live.",
      confirmText: 'Restore as draft',
    }
    const ok = await confirm({
      title: copy.title,
      description: copy.description,
      confirmText: copy.confirmText ?? 'Restore',
      cancelText: copy.cancelText ?? 'Cancel',
    })
    if (!ok) return
    const restored = await onRestore(version)
    if (restored) onOpenChange(false)
  }

  const handleDelete = async (version: VersionRowData) => {
    const copy = deleteConfirm?.(version) ?? {
      title: `Delete v${version.versionNumber}?`,
      description: 'This permanently removes the snapshot. This action cannot be undone.',
      confirmText: 'Delete',
    }
    const ok = await confirm({
      title: copy.title,
      description: copy.description,
      confirmText: copy.confirmText ?? 'Delete',
      cancelText: copy.cancelText ?? 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await onDelete?.(version)
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
            {isLoading ? (
              <div className='flex justify-center py-12'>
                <Loader2 className='size-5 animate-spin text-muted-foreground' />
              </div>
            ) : rows.length === 0 ? (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                {emptyMessage ?? 'No published versions yet. Publish to create the first one.'}
              </p>
            ) : (
              <ul className='space-y-3 pr-4'>
                {rows.map((v) => {
                  const isCurrent = v.id === currentVersionId
                  const headline =
                    v.title ??
                    v.label ??
                    (v.versionNumber != null ? `Version ${v.versionNumber}` : 'Untitled version')
                  return (
                    <li
                      key={v.id}
                      className='rounded-2xl border px-3 pt-1 pb-2 transition-colors hover:border-primary/30'>
                      <div className='mb-2 flex items-center gap-2'>
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
                          <h3 className='truncate text-sm font-semibold'>{headline}</h3>
                          <p className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
                            {v.editorName ? (
                              <>
                                <span className='truncate'>{v.editorName}</span>
                                <span className='shrink-0'>&middot;</span>
                              </>
                            ) : null}
                            <span className='shrink-0'>
                              {formatRelativeTime(v.createdAt, true)}
                            </span>
                            {isCurrent && (
                              <span className='shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700'>
                                Current
                              </span>
                            )}
                          </p>
                        </div>
                        <div className='flex shrink-0 items-center gap-1'>
                          {renderRowActions?.(v, { isCurrent })}
                          {!isCurrent && (
                            <Tooltip content='Restore as draft'>
                              <Button
                                size='icon-xs'
                                variant='outline'
                                onClick={() => handleRestore(v)}>
                                <Undo2 />
                              </Button>
                            </Tooltip>
                          )}
                          {onDelete && !isCurrent && (
                            <Tooltip content='Delete version'>
                              <Button
                                size='icon-xs'
                                variant='outline'
                                className='text-muted-foreground hover:text-destructive'
                                onClick={() => handleDelete(v)}>
                                <Trash2 />
                              </Button>
                            </Tooltip>
                          )}
                        </div>
                      </div>

                      {onRenameLabel ? (
                        <VersionLabelRow
                          label={v.label}
                          isEditing={editingId === v.id}
                          isPending={pendingRenameId === v.id}
                          onStartEdit={() => setEditingId(v.id)}
                          onSave={(value) => saveLabel(v.id, value)}
                          onCancel={() => setEditingId(null)}
                          onClear={() => saveLabel(v.id, null)}
                        />
                      ) : null}
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
