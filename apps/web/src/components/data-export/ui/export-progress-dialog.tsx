// ~/components/data-export/ui/export-progress-dialog.tsx

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
import { Progress } from '@auxx/ui/components/progress'
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle2, Download, Loader2, XCircle } from 'lucide-react'
import { api } from '~/trpc/react'
import { useExportJobRealtime } from '../hooks/use-export-realtime'

interface ExportProgressDialogProps {
  /** Export job id, or null when nothing is running. */
  jobId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Small progress dialog for a running CSV export. Tracks the job over realtime
 * (with a slow safety poll), then surfaces a Download button on completion.
 */
export function ExportProgressDialog({ jobId, open, onOpenChange }: ExportProgressDialogProps) {
  useExportJobRealtime(jobId)

  const { data: job } = api.dataExport.getById.useQuery(
    { id: jobId ?? '' },
    {
      enabled: !!jobId && open,
      // Safety poll while the job is in flight; realtime does the live work.
      refetchInterval: (query) => {
        const status = query.state.data?.status
        return status === 'pending' || status === 'processing' ? 3000 : false
      },
    }
  )

  const getDownloadUrl = api.dataExport.getDownloadUrl.useMutation()
  const cancel = api.dataExport.cancel.useMutation()
  const utils = api.useUtils()

  const status = job?.status ?? 'pending'
  const total = job?.totalRecords ?? 0
  const processed = job?.processedRecords ?? 0
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  const isRunning = status === 'pending' || status === 'processing'

  const handleDownload = async () => {
    if (!jobId) return
    try {
      const { url } = await getDownloadUrl.mutateAsync({ id: jobId })
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch (error) {
      toastError({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'Could not get download link',
      })
    }
  }

  const handleCancel = async () => {
    if (!jobId) return
    await cancel.mutateAsync({ id: jobId })
    await utils.dataExport.getById.invalidate({ id: jobId })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm'>
        <DialogHeader>
          <DialogTitle>Export to CSV</DialogTitle>
          <DialogDescription>
            {status === 'completed'
              ? 'Your export is ready to download.'
              : status === 'failed'
                ? 'The export failed.'
                : status === 'canceled'
                  ? 'The export was canceled.'
                  : 'Preparing your export…'}
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-3 py-2'>
          {isRunning && (
            <>
              <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <Loader2 className='size-4 animate-spin' />
                <span>
                  {total > 0
                    ? `${processed.toLocaleString()} of ${total.toLocaleString()} records`
                    : 'Counting records…'}
                </span>
              </div>
              <Progress value={percent} />
            </>
          )}

          {status === 'completed' && (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <CheckCircle2 className='size-4 text-emerald-600' />
              <span>{total.toLocaleString()} records exported</span>
            </div>
          )}

          {status === 'failed' && (
            <div className='flex items-start gap-2 text-sm text-destructive'>
              <XCircle className='size-4 shrink-0' />
              <span>{job?.error ?? 'Something went wrong.'}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          {isRunning && (
            <Button variant='outline' onClick={handleCancel} loading={cancel.isPending}>
              Cancel export
            </Button>
          )}
          {status === 'completed' && (
            <Button onClick={handleDownload} loading={getDownloadUrl.isPending}>
              <Download />
              Download CSV
            </Button>
          )}
          {(status === 'failed' || status === 'canceled') && (
            <Button variant='outline' onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
