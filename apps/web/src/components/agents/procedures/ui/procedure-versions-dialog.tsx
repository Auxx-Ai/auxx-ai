// apps/web/src/components/agents/procedures/ui/procedure-versions-dialog.tsx
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
import { cn } from '@auxx/ui/lib/utils'
import { Loader2, Undo2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useProcedure } from '../hooks/use-procedure'
import { useProcedureMutations } from '../hooks/use-procedure-mutations'

interface ProcedureVersionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  procedureId: string
  /** Bumped after a restore so the editor canvas remounts onto the new draft doc. */
  onReload?: () => void
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

/**
 * Published-version history for a procedure — a trimmed
 * `article-versions-dialog`. Lists versions newest-first (the active one badged
 * **Current**), and **Restore as draft** loads a snapshot back into the draft +
 * reloads the canvas via `onReload`. No diff / preview / label-edit — those are
 * KB-only (Decisions D-B/D-C).
 */
export function ProcedureVersionsDialog({
  open,
  onOpenChange,
  procedureId,
  onReload,
}: ProcedureVersionsDialogProps) {
  const versionsQuery = api.procedure.listVersions.useQuery({ id: procedureId }, { enabled: open })
  const { meta } = useProcedure(procedureId)
  const { revert } = useProcedureMutations()
  const [confirm, ConfirmDialog] = useConfirm()

  const versions = versionsQuery.data ?? []
  const activeVersionId = meta?.activeVersionId ?? null

  const handleRestore = async (versionId: string, versionNumber: number | null) => {
    const ok = await confirm({
      title: `Restore v${versionNumber} as draft?`,
      description: `Your current draft will be replaced with v${versionNumber}'s content. Publish to make it live.`,
      confirmText: 'Restore as draft',
      cancelText: 'Cancel',
    })
    if (!ok) return
    const success = await revert(procedureId, versionId)
    if (success) {
      onReload?.()
      onOpenChange(false)
    }
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
                No published versions yet. Publish to create the first one.
              </p>
            ) : (
              <ul className='space-y-3 pr-4'>
                {versions.map((v) => {
                  const isCurrent = v.id === activeVersionId
                  return (
                    <li
                      key={v.id}
                      className='flex items-center gap-2 rounded-2xl border px-3 py-2 transition-colors hover:border-primary/30'>
                      <span
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold inset-shadow-xs inset-shadow-black/20',
                          isCurrent ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'
                        )}>
                        v{v.versionNumber}
                      </span>
                      <div className='min-w-0 flex-1'>
                        <h3 className='truncate text-sm font-semibold'>{v.label || '—'}</h3>
                        <p className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
                          <span className='shrink-0'>{relativeTime(v.createdAt)}</span>
                          {isCurrent && (
                            <span className='shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700'>
                              Current
                            </span>
                          )}
                        </p>
                      </div>
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
