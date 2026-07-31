'use client'

// apps/web/src/components/workflow/workflow-submenu.tsx

import { PermissionKey } from '@auxx/lib/permissions/client'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Loader2, Play, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef } from 'react'
import { createWorkflowInvalidator } from '~/components/workflow/utils/invalidate-resource'
import { useAccess } from '~/providers/capabilities-provider'
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
  const router = useRouter()
  const { entityDefinitionId } = recordId ? parseRecordId(recordId) : { entityDefinitionId: '' }

  // Running a workflow is the `view` rung, so the list itself needs no gate.
  // CREATING one is a different action on a different area — coarse
  // `workflows.manage`, the same key `mass-workflow-trigger-dialog` uses.
  const { can } = useAccess()
  const canCreateWorkflow = can(PermissionKey.workflowsManage)

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

  // Creates a manual-trigger workflow already wired to this entity definition
  // and drops the user into the builder — the same mutation the bulk dialog's
  // "Create Workflow" escape hatch calls.
  const createForResource = api.workflow.createForResource.useMutation({
    onSuccess: (created) => {
      if (created?.id) router.push(`/app/workflows/${created.id}`)
    },
    onError: (error) => {
      toastError({ title: 'Failed to create workflow', description: error.message })
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

        {/* Always present, so the submenu is never a dead end — an entity with
            no manual workflows is the case where "create one" is MOST useful,
            and it is exactly the case where the list above says nothing
            actionable. Disabled rather than hidden without `workflows.manage`:
            the capability exists, this member just lacks it, and a row that
            silently vanishes teaches nothing. */}
        {hasWorkflows ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          disabled={
            !canCreateWorkflow || createForResource.isPending || entityDefinitionId.length === 0
          }
          onSelect={() => createForResource.mutate({ entityDefinitionId })}>
          {createForResource.isPending ? <Loader2 className='animate-spin' /> : <Plus />}
          Create workflow
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
