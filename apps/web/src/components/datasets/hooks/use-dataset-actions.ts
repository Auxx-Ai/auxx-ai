// apps/web/src/components/datasets/hooks/use-dataset-actions.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface UseDatasetActionsProps {
  datasetId: string
  datasetName?: string
  onSuccess?: () => void
  redirectAfterDelete?: boolean
}

/**
 * Hook for dataset actions (delete, archive, navigation)
 * Reusable across dataset card and dataset detail page
 */
export function useDatasetActions({
  datasetId,
  datasetName,
  onSuccess,
  redirectAfterDelete = false,
}: UseDatasetActionsProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()

  const deleteDataset = api.dataset.delete.useMutation({
    onSuccess: () => {
      onSuccess?.()
      if (redirectAfterDelete) {
        router.push('/app/datasets')
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete dataset', description: error.message })
    },
  })

  const archiveDataset = api.dataset.archive.useMutation({
    onSuccess: () => {
      onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to archive dataset', description: error.message })
    },
  })

  /**
   * Navigate to dataset browse/search tab
   */
  const handleBrowse = () => {
    router.push(`/app/datasets/${datasetId}?tab=search`)
  }

  /**
   * Navigate to dataset settings tab
   */
  const handleSettings = () => {
    router.push(`/app/datasets/${datasetId}?tab=settings`)
  }

  /**
   * Delete dataset with confirmation dialog
   */
  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Dataset',
      description: `Are you sure you want to permanently delete "${datasetName || 'this dataset'}"? This action cannot be undone and will remove all associated documents and data.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await deleteDataset.mutateAsync({ id: datasetId })
    }
  }

  /**
   * Archive dataset with confirmation dialog
   */
  const handleArchive = async () => {
    const confirmed = await confirm({
      title: 'Archive Dataset',
      description:
        'Are you sure you want to archive this dataset? It will be hidden from the main view but can be restored later.',
      confirmText: 'Archive',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      await archiveDataset.mutateAsync({ id: datasetId })
    }
  }

  return {
    handleBrowse,
    handleSettings,
    handleDelete,
    handleArchive,
    isDeleting: deleteDataset.isPending,
    isArchiving: archiveDataset.isPending,
    ConfirmDialog,
  }
}
