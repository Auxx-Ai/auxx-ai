'use client'

// apps/web/src/app/(protected)/app/settings/import-history/_components/import-history-overview.tsx

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { ImportHistoryList } from './import-history-list'

/**
 * Import history overview container.
 * Handles delete confirmation and navigation logic.
 */
export function ImportHistoryOverview() {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  useUser({
    requireOrganization: true,
    requireRoles: ['ADMIN', 'OWNER'],
  })

  const deleteJob = api.dataImport.deleteJob.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Import job deleted' })
      utils.dataImport.listJobs.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting import', description: error.message })
    },
  })

  /** Prompts for confirmation and deletes the import job */
  const handleDeleteJob = async (jobId: string) => {
    const confirmed = await confirm({
      title: 'Delete import job?',
      description:
        'This will permanently delete the import job and all associated data. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteJob.mutate({ jobId })
    }
  }

  return (
    <>
      <ImportHistoryList onDeleteJob={handleDeleteJob} />
      <ConfirmDialog />
    </>
  )
}
