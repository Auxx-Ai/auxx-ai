// apps/web/src/app/(protected)/app/datasets/[datasetId]/_components/dataset-actions.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { WorkflowSubMenu } from '~/components/workflow/workflow-submenu'
import { toRecordId } from '@auxx/types/resource'
import { Upload, MoreHorizontal, RefreshCw, Download, Archive, Trash2 } from 'lucide-react'
import { useDatasetDetail } from './dataset-detail-provider'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { useDatasetActions } from '~/components/datasets/hooks/use-dataset-actions'

/**
 * Actions component for dataset detail page header
 */
export function DatasetActions() {
  const { dataset, setCurrentTab, refetch, setUploadDialogOpen } = useDatasetDetail()

  const { handleDelete, handleArchive, isDeleting, isArchiving, ConfirmDialog } = useDatasetActions({
    datasetId: dataset?.id ?? '',
    datasetName: dataset?.name,
    onSuccess: refetch,
    redirectAfterDelete: true,
  })

  /**
   * Open upload dialog and switch to documents tab
   */
  const handleUpload = () => {
    setCurrentTab('documents')
    setUploadDialogOpen(true)
  }

  /**
   * Refresh dataset data
   */
  const handleRefresh = () => {
    refetch()
    toastSuccess({
      title: 'Dataset refreshed',
      description: 'Dataset information has been updated.',
    })
  }

  /**
   * Export dataset (placeholder)
   */
  const handleExport = async () => {
    try {
      toastSuccess({
        title: 'Export started',
        description: 'Your dataset export is being prepared.',
      })
    } catch (error) {
      toastError({ title: 'Export failed', description: 'Failed to start dataset export.' })
    }
  }

  if (!dataset) {
    return (
      <div className="flex gap-2">
        <Button disabled variant="outline" size="sm">
          <Upload />
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Primary Actions */}
        <Button onClick={handleUpload} size="sm">
          <Upload />
          Upload
        </Button>

        {/* More Actions Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <WorkflowSubMenu recordId={toRecordId('dataset', dataset.id)} onSuccess={refetch} />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleRefresh}>
              <RefreshCw />
              Refresh
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExport}>
              <Download />
              Export
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleArchive} disabled={isArchiving}>
              <Archive />
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete} variant="destructive" disabled={isDeleting}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog />
    </>
  )
}
