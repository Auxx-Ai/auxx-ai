// apps/web/src/components/data-import/import-actions.tsx

'use client'

import { X, Save, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface WizardState {
  jobId: string | null
  isLoading: boolean
  isComplete: boolean
  canSaveMapping: boolean
  saveMapping: () => Promise<void>
  isSaving: boolean
}

interface ImportActionsProps {
  wizard: WizardState
  basePath: string
  importBasePath: string
}

/**
 * Header actions for the import page.
 */
export function ImportActions({ wizard, basePath, importBasePath }: ImportActionsProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const deleteJob = api.dataImport.deleteJob.useMutation()

  const handleCancel = async () => {
    if (wizard.jobId) {
      const confirmed = await confirm({
        title: 'Cancel Import?',
        description: 'Your import progress will be lost. Are you sure?',
        confirmText: 'Cancel Import',
        cancelText: 'Continue Editing',
        destructive: true,
      })

      if (!confirmed) return

      try {
        await deleteJob.mutateAsync({ jobId: wizard.jobId })
      } catch (error) {
        toastError({
          title: 'Failed to delete import',
          description: error instanceof Error ? error.message : 'An error occurred',
        })
        return
      }
    }

    router.push(basePath)
  }

  const handleStartOver = async () => {
    if (wizard.jobId) {
      const confirmed = await confirm({
        title: 'Start a new import?',
        description: 'This will delete your current import progress and start fresh.',
        confirmText: 'Start New Import',
        cancelText: 'Cancel',
        destructive: true,
      })

      if (!confirmed) return

      try {
        await deleteJob.mutateAsync({ jobId: wizard.jobId })
      } catch (error) {
        toastError({
          title: 'Failed to delete import',
          description: error instanceof Error ? error.message : 'An error occurred',
        })
        return
      }
    }

    router.push(`${importBasePath}/new?step=upload`)
  }

  // Show skeleton while loading
  if (wizard.isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-20" />
      </div>
    )
  }

  // For completed imports, just show a close button
  if (wizard.isComplete) {
    return (
      <Button variant="ghost" size="sm" onClick={() => router.push(basePath)}>
        <X />
        Close
      </Button>
    )
  }

  return (
    <>
      <ConfirmDialog />
      <div className="flex items-center gap-2">
        {wizard.canSaveMapping && (
          <Button
            variant="outline"
            size="sm"
            onClick={wizard.saveMapping}
            loading={wizard.isSaving}
            loadingText="Saving...">
            <Save />
            Save Mapping
          </Button>
        )}

        {wizard.jobId && (
          <Button variant="ghost" size="sm" onClick={handleStartOver}>
            <RotateCcw />
            Start Over
          </Button>
        )}

        <Button variant="ghost" size="sm" onClick={handleCancel}>
          <X />
          Cancel
        </Button>
      </div>
    </>
  )
}
