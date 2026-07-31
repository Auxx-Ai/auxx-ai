'use client'

// apps/web/src/components/workflow/manual-trigger-button.tsx

import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Play } from 'lucide-react'
import { type ReactNode, useMemo, useRef } from 'react'
import { createWorkflowInvalidator } from '~/components/workflow/utils/invalidate-resource'
import { useWorkflowRunStatusStore } from '~/stores/workflow-run-status-store'
import { api } from '~/trpc/react'
import { showWorkflowProgressToast } from './workflow-progress-toast'

/**
 * ManualTriggerButton: Trigger workflows manually for a resource
 *
 * Displays a button that opens a dropdown menu with available workflows
 * for the given entity. Clicking a workflow triggers it.
 *
 * The component automatically hides when no workflows are available.
 *
 * @example
 * // Default button
 * <ManualTriggerButton
 *   entityDefinitionId="contact"
 *   resourceId={contactId}
 *   buttonVariant="ghost"
 *   buttonSize="icon-sm"
 *   tooltipContent="Trigger workflow"
 * />
 *
 * @example
 * // Custom trigger element
 * <ManualTriggerButton entityDefinitionId="thread" resourceId={threadId}>
 *   <Button variant="ghost" size="icon">
 *     <Zap />
 *   </Button>
 * </ManualTriggerButton>
 */
interface ManualTriggerButtonProps {
  /** Entity definition ID: 'contact', 'ticket', 'thread', or custom entity ID */
  // entityDefinitionId: string

  /** Record ID */
  recordId: RecordId

  /** Button variant (default: 'ghost') */
  buttonVariant?: 'ghost' | 'outline' | 'default'

  /** Button size (default: 'icon-sm') */
  buttonSize?: 'icon-sm' | 'icon-xs' | 'icon' | 'sm'

  /** Custom tooltip content (default: 'Trigger workflow') */
  tooltipContent?: string

  /** Custom button className */
  buttonClassName?: string

  /** Called after successful trigger (for refetching data) */
  onSuccess?: () => void

  /** Optional custom trigger element. If provided, replaces the default button */
  children?: ReactNode
}

/** A manually-triggerable workflow as the picker renders it. */
interface ManualWorkflow {
  id: string
  name: string
}

/**
 * The query + trigger half of the manual-workflow picker, without any chrome.
 *
 * Kept separate from the component body so the query/trigger pair reads on its
 * own. The submenu form lives in `workflow-submenu.tsx` (`WorkflowSubMenu`),
 * which predates this file's involvement and is what `RecordActionsMenu` uses —
 * a Radix `DropdownMenu` cannot nest inside a `DropdownMenuItem`, so the two
 * genuinely are different components rather than one with a variant.
 */
function useManualTrigger(recordId: RecordId, onSuccess?: () => void) {
  const { entityDefinitionId } = recordId ? parseRecordId(recordId) : { entityDefinitionId: '' }

  // Store ref to selected workflow for use in onSuccess
  const selectedWorkflowRef = useRef<ManualWorkflow | null>(null)
  // Query available workflows for this entity
  const { data: workflows, isLoading: workflowsLoading } = api.workflow.getManualWorkflows.useQuery(
    { entityDefinitionId },
    { enabled: recordId.length > 0 && entityDefinitionId.length > 0 }
  )

  // Trigger mutation
  const { mutate: triggerWorkflow, isPending: triggerLoading } =
    api.workflow.triggerManualResource.useMutation({
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

  const trigger = (workflow: ManualWorkflow) => {
    selectedWorkflowRef.current = workflow
    triggerWorkflow({ workflowAppId: workflow.id, recordId })
  }

  return {
    workflows: workflows as ManualWorkflow[] | undefined,
    isLoading: workflowsLoading || triggerLoading,
    trigger,
  }
}

/**
 * ManualTriggerButton component for triggering workflows on resources
 */
export function ManualTriggerButton({
  // entityDefinitionId,
  recordId,
  buttonVariant = 'ghost',
  buttonSize = 'icon-sm',
  tooltipContent = 'Trigger workflow',
  buttonClassName,
  onSuccess,
  children,
}: ManualTriggerButtonProps) {
  const {
    workflows,
    isLoading,
    trigger: handleTriggerWorkflow,
  } = useManualTrigger(recordId, onSuccess)

  // Show button only if workflows exist
  const shouldShow = useMemo(() => {
    return workflows && workflows.length > 0
  }, [workflows])

  if (!shouldShow) return null

  /** Default button trigger */
  const defaultTrigger = (
    <Button
      variant={buttonVariant}
      size={buttonSize}
      className={buttonClassName}
      loading={isLoading}
      disabled={isLoading}>
      <Play />
    </Button>
  )

  return (
    <DropdownMenu modal={false}>
      {/* <Tooltip content="Run Workflow"> */}
      <DropdownMenuTrigger asChild>{children ?? defaultTrigger}</DropdownMenuTrigger>
      {/* </Tooltip> */}

      <DropdownMenuContent align='end' className='w-48'>
        {workflows?.map((workflow) => (
          <DropdownMenuItem key={workflow.id} onClick={() => handleTriggerWorkflow(workflow)}>
            <Play />
            {workflow.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
