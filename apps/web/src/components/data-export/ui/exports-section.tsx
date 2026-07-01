// apps/web/src/components/data-export/ui/exports-section.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { toastError } from '@auxx/ui/components/toast'
import { Download } from 'lucide-react'
import { SettingsSection } from '~/components/global/settings-page'
import { useResources } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useExportListRealtime } from '../hooks/use-export-list-realtime'
import { ExportJobCard } from './export-job-card'

/**
 * Exports history section: a card grid of past {@link ExportJobCard}s over
 * `api.dataExport.list`, with self-contained delete + cancel wiring and live progress over
 * Soketi realtime. Read-only history — exports are started from the table toolbar's
 * Import/Export dropdown, not here. See plans/exporter/04-history-page-plan.md.
 */
export function ExportsSection() {
  const { isLoading: isLoadingResources } = useResources()
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  useExportListRealtime()

  const { data: jobs, isLoading: isLoadingJobs } = api.dataExport.list.useQuery(undefined, {
    // Safety poll while any export is in flight; realtime does the live work.
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.status === 'pending' || job.status === 'processing')
        ? 3000
        : false,
  })

  const deleteJob = api.dataExport.delete.useMutation({
    onSuccess: () => utils.dataExport.list.invalidate(),
    onError: (error) => toastError({ title: 'Error deleting export', description: error.message }),
  })

  const cancelJob = api.dataExport.cancel.useMutation({
    onSuccess: () => utils.dataExport.list.invalidate(),
    onError: (error) => toastError({ title: 'Error canceling export', description: error.message }),
  })

  const handleDelete = async (jobId: string) => {
    const ok = await confirm({
      title: 'Delete export?',
      description: 'This permanently deletes the export and its file. This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) deleteJob.mutate({ id: jobId })
  }

  const isLoading = isLoadingJobs || isLoadingResources
  const isEmpty = !isLoading && (!jobs || jobs.length === 0)

  return (
    <SettingsSection
      icon={Download}
      title='Exports'
      description='CSV exports of your records. Start a new export from the table toolbar on any entity page.'>
      <div className='@container'>
        <div className='grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'>
          {isLoading &&
            [...Array(3)].map((_, i) => (
              <ListCard key={`skeleton-${i}`} loading descriptionLines={0} />
            ))}
          {jobs?.map((job) => (
            <ExportJobCard
              key={job.id}
              job={job}
              onDelete={() => void handleDelete(job.id)}
              onCancel={() => cancelJob.mutate({ id: job.id })}
            />
          ))}
          {isEmpty && (
            <ListCard
              variant='placeholder'
              classNames={{ icon: 'border-dashed' }}
              icon={<Download className='size-4 text-muted-foreground' />}
              title='No exports yet'
              subtitle='Exports'
              description='Export records to CSV from the Import/Export menu in any table toolbar.'
            />
          )}
        </div>
      </div>

      <ConfirmDialog />
    </SettingsSection>
  )
}
