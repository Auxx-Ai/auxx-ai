'use client'

// apps/web/src/components/workflow/mass-workflow-trigger-dialog.tsx

import { useState } from 'react'
import { Play } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { useWorkflowRunStatusStore } from '~/stores/workflow-run-status-store'
import { showWorkflowProgressToast } from './workflow-progress-toast'
import { invalidateBatchResources } from '~/lib/workflow'

/**
 * Mass workflow trigger dialog
 *
 * Allows user to select a workflow and trigger it for multiple resources
 * Reusable across all resource types (contacts, tickets, threads, messages, entities)
 */
interface MassWorkflowTriggerDialogProps {
  /** Dialog open state */
  open: boolean
  /** Dialog open state change handler */
  onOpenChange: (open: boolean) => void
  /** Resource type */
  resourceType?: 'contact' | 'ticket' | 'thread' | 'message' | 'entity'
  /** Entity slug - required when resourceType is 'entity' */
  entitySlug?: string
  /** Array of resource IDs to trigger workflow for */
  resourceIds: string[]
  /** Success callback (for refetching data) */
  onSuccess?: () => void
}

export function MassWorkflowTriggerDialog({
  open,
  onOpenChange,
  resourceType = 'contact',
  entitySlug,
  resourceIds,
  onSuccess,
}: MassWorkflowTriggerDialogProps) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')

  // Query available workflows
  const { data: workflows, isLoading: workflowsLoading } = api.workflow.getManualWorkflows.useQuery(
    { resourceType, entitySlug },
    { enabled: open && resourceIds.length > 0 && (resourceType !== 'entity' || !!entitySlug) }
  )

  // Get selected workflow name
  const selectedWorkflow = workflows?.find((w) => w.id === selectedWorkflowId)

  // Bulk trigger mutation
  const triggerBulk = api.workflow.triggerManualResourceBulk.useMutation({
    onSuccess: (data) => {
      const { summary, results } = data

      // Extract successful runs for SSE tracking
      const successfulRuns = results
        .filter((r) => r.success && r.workflowRunId)
        .map((r) => ({
          resourceId: r.resourceId,
          workflowRunId: r.workflowRunId!,
        }))

      // Track batch for SSE subscription if any succeeded
      if (successfulRuns.length > 0) {
        const batchId = useWorkflowRunStatusStore.getState().trackBatch({
          workflowName: selectedWorkflow?.name ?? 'Workflow',
          resourceType,
          results: successfulRuns,
          onComplete: () => {
            // Invalidate all resources efficiently (list queries only once)
            invalidateBatchResources(
              resourceType,
              successfulRuns.map(({ resourceId }) => resourceId)
            )
          },
        })

        // Show progress toast
        showWorkflowProgressToast({ batchId })
      }

      // Close dialog immediately - progress shown in toast
      onOpenChange(false)

      if (summary.failed === 0) {
        onSuccess?.()
      } else if (summary.succeeded > 0) {
        toastError({
          title: 'Partially completed',
          description: `${summary.succeeded} workflows triggered successfully, ${summary.failed} failed`,
        })
        onSuccess?.()
      } else {
        toastError({
          title: 'All workflows failed',
          description: `Failed to trigger workflows for ${summary.failed} ${resourceType}${summary.failed !== 1 ? 's' : ''}`,
        })
      }
    },
    onError: (error) => {
      toastError({
        title: 'Failed to trigger workflows',
        description: error.message,
      })
    },
  })

  /** Handle workflow trigger */
  const handleTrigger = () => {
    if (!selectedWorkflowId) {
      toastError({
        title: 'No workflow selected',
        description: 'Please select a workflow to trigger',
      })
      return
    }

    triggerBulk.mutate({
      workflowAppId: selectedWorkflowId,
      resourceType,
      resourceIds,
      entitySlug, // Pass entitySlug for entity resources
    })
  }

  const isLoading = workflowsLoading || triggerBulk.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position="tc" size="sm">
        <DialogHeader>
          <DialogTitle>Run Workflow</DialogTitle>
          <DialogDescription>
            Select a workflow to run for {resourceIds.length} selected {resourceType}
            {resourceIds.length !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        {/* Workflow Selection */}
        {workflowsLoading ? (
          <div className="text-sm text-muted-foreground">Loading workflows...</div>
        ) : workflows && workflows.length > 0 ? (
          <Select
            value={selectedWorkflowId}
            onValueChange={setSelectedWorkflowId}
            disabled={isLoading}>
            <SelectTrigger>
              <SelectValue placeholder="Select a workflow..." />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-sm text-muted-foreground">
            No manual trigger workflows available for {resourceType}s
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleTrigger}
            disabled={!selectedWorkflowId || isLoading}
            loading={isLoading}
            size="sm"
            variant="outline"
            loadingText="Triggering...">
            <Play />
            Run Workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
