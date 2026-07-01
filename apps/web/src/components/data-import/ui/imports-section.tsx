// apps/web/src/components/data-import/ui/imports-section.tsx
'use client'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Import } from 'lucide-react'
import { SettingsSection } from '~/components/global/settings-page'
import { useResources } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { ImportJobCard } from './import-job-card'

/**
 * Imports history section: a card grid of past {@link ImportJobCard}s over
 * `api.dataImport.listJobs`, self-contained delete wiring. Read-only history — imports are
 * started from each entity page's toolbar, not here. Wraps the shared {@link SettingsSection},
 * mirroring `WebhookEndpointsSection`. See plans/exporter/04-history-page-plan.md.
 */
export function ImportsSection() {
  const { data: jobs, isLoading: isLoadingJobs } = api.dataImport.listJobs.useQuery({})
  const { isLoading: isLoadingResources } = useResources()
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const deleteJob = api.dataImport.deleteJob.useMutation({
    onSuccess: () => utils.dataImport.listJobs.invalidate(),
    onError: (error) => toastError({ title: 'Error deleting import', description: error.message }),
  })

  const handleDelete = async (jobId: string) => {
    const ok = await confirm({
      title: 'Delete import job?',
      description:
        'This will permanently delete the import job and all associated data. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) deleteJob.mutate({ jobId })
  }

  const isLoading = isLoadingJobs || isLoadingResources
  const isEmpty = !isLoading && (!jobs || jobs.length === 0)

  return (
    <SettingsSection
      icon={Import}
      title='Imports'
      description='Data you have imported into Auxx. Start a new import from any entity page.'>
      <div className='flex flex-col gap-2'>
        {isLoading &&
          [...Array(3)].map((_, i) => (
            <div
              key={`skeleton-${i}`}
              className='flex items-center justify-between rounded-2xl border py-2 px-3'>
              <div className='flex flex-row items-center gap-3'>
                <Skeleton className='size-8 rounded-lg shrink-0' />
                <div className='flex flex-col gap-1'>
                  <Skeleton className='h-4 w-40' />
                  <Skeleton className='h-3 w-56' />
                </div>
              </div>
              <Skeleton className='h-5 w-16 rounded-full' />
            </div>
          ))}
        {jobs?.map((job) => (
          <ImportJobCard key={job.id} job={job} onDelete={() => void handleDelete(job.id)} />
        ))}
        {isEmpty && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Import />
              </EmptyMedia>
              <EmptyTitle>No imports yet</EmptyTitle>
              <EmptyDescription>
                Import data from any entity page — Contacts, Tickets, or a custom entity.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      <ConfirmDialog />
    </SettingsSection>
  )
}
