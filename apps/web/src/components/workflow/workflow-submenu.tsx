'use client'

// apps/web/src/components/workflow/workflow-submenu.tsx

import { parseRecordId, type RecordId } from '@auxx/types/resource'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Loader2, Play } from 'lucide-react'
import { useRef } from 'react'
import { createWorkflowInvalidator } from '~/lib/workflow'
import { useWorkflowRunStatusStore } from '~/stores/workflow-run-status-store'
import { api } from '~/trpc/react'
import { showWorkflowProgressToast } from './workflow-progress-toast'

/**
 * Props for the WorkflowSubMenu component
 */
interface WorkflowSubMenuProps {
  /** Record ID to trigger workflow for */
  recordId: RecordId
  /** Called after successful trigger */
  onSuccess?: () => void
}

/**
 * WorkflowSubMenu component for triggering workflows from dropdown menus
 *
 * Displays a submenu with available workflows for the resource type.
 * Shows loading state while fetching, then displays available workflows.
 * Shows "No workflows available" if none exist.
 */
export function WorkflowSubMenu({ recordId, onSuccess }: WorkflowSubMenuProps) {
  const { entityDefinitionId, entityInstanceId } = recordId
    ? parseRecordId(recordId)
    : { entityDefinitionId: '', entityInstanceId: '' }

  // Store ref to selected workflow for use in onSuccess
  const selectedWorkflowRef = useRef<{ id: string; name: string } | null>(null)

  // Query available workflows for this entity
  const { data: workflows, isLoading: workflowsLoading } = api.workflow.getManualWorkflows.useQuery(
    { entityDefinitionId },
    {
      enabled: recordId.length > 0 && entityDefinitionId.length > 0,
      staleTime: 30000, // Cache for 30 seconds to avoid refetch flicker
    }
  )

  // Trigger mutation
  const triggerWorkflow = api.workflow.triggerManualResource.useMutation({
    onSuccess: (data) => {
      // Track the run for SSE subscription with automatic resource invalidation
      useWorkflowRunStatusStore.getState().trackRun({
        runId: data.workflowRunId,
        workflowName: selectedWorkflowRef.current?.name ?? 'Workflow',
        recordId,
        onComplete: createWorkflowInvalidator(recordId),
      })

      // Show progress toast
      showWorkflowProgressToast({ runId: data.workflowRunId })

      onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to trigger workflow',
        description: error.message,
      })
    },
  })

  /** Handle workflow selection */
  const handleTriggerWorkflow = (workflow: { id: string; name: string }) => {
    selectedWorkflowRef.current = workflow
    triggerWorkflow.mutate({
      workflowAppId: workflow.id,
      recordId,
    })
  }

  const hasWorkflows = workflows && workflows.length > 0

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Play />
        Run Workflow
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='w-48'>
        {workflowsLoading ? (
          <DropdownMenuItem disabled>
            <Loader2 className='animate-spin' />
            Loading...
          </DropdownMenuItem>
        ) : hasWorkflows ? (
          workflows.map((workflow) => (
            <DropdownMenuItem
              key={workflow.id}
              onClick={() => handleTriggerWorkflow(workflow)}
              disabled={triggerWorkflow.isPending}>
              <Play />
              {workflow.name}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled className='text-muted-foreground'>
            No workflows available
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
