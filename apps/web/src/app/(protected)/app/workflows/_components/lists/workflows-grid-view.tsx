// apps/web/src/app/(protected)/app/workflows/_components/lists/workflows-grid-view.tsx
'use client'

import { TRIGGER_NAME_MAP, type WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { ListCard } from '@auxx/ui/components/list-card'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Copy, Edit, Pause, Play, Trash } from 'lucide-react'
import { useState } from 'react'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import { DuplicateWorkflowDialog } from '~/components/workflow/dialogs/duplicate-workflow-dialog'
import { WorkflowFormDialog } from '~/components/workflow/dialogs/workflow-form-dialog'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useWorkflows } from '../providers/workflows-provider'

interface WorkflowCardProps {
  workflow: any
}

function WorkflowCard({ workflow }: WorkflowCardProps) {
  const { refetchWorkflows } = useWorkflows()
  const [confirm, ConfirmDialog] = useConfirm()
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)

  const updateWorkflow = api.workflow.update.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Workflow updated' })
      refetchWorkflows()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update workflow', description: error.message })
    },
  })

  const deleteWorkflow = api.workflow.delete.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Workflow deleted' })
      refetchWorkflows()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete workflow', description: error.message })
    },
  })

  const handleToggleEnabled = async () => {
    await updateWorkflow.mutateAsync({ id: workflow.id, enabled: !workflow.enabled })
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete workflow?',
      description: 'This will permanently delete this workflow and all its execution history.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await deleteWorkflow.mutateAsync({ id: workflow.id })
    }
  }

  return (
    <>
      <ConfirmDialog />
      <ListCard
        href={`/app/workflows/${workflow.id}`}
        ariaLabel={workflow.name}
        title={workflow.name}
        icon={
          workflow.icon ? (
            <EntityIcon iconId={workflow.icon.iconId} color={workflow.icon.color} size='default' />
          ) : (
            unifiedNodeRegistry.getNodeIcon(workflow.triggerType, 'size-4')
          )
        }
        status={{
          tone: workflow.enabled ? 'good' : 'muted',
          label: workflow.enabled ? 'Enabled' : 'Disabled',
        }}
        subtitle={<LastUpdated timestamp={workflow.updatedAt} prefix='' includeSeconds={true} />}
        descriptionLines={0}
        badges={
          <Badge variant='pill' size='sm' className='shrink-0'>
            {TRIGGER_NAME_MAP[workflow.triggerType as WorkflowTriggerType] || 'Unknown'}
          </Badge>
        }
        menu={
          <>
            <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
              <Edit />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDuplicateDialogOpen(true)}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            <FavoriteToggleMenuItem targetType='WORKFLOW' targetIds={{ workflowId: workflow.id }} />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleToggleEnabled} disabled={updateWorkflow.isPending}>
              {workflow.enabled ? (
                <>
                  <Pause />
                  Disable
                </>
              ) : (
                <>
                  <Play />
                  Enable
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleDelete} variant='destructive'>
              <Trash />
              Delete
            </DropdownMenuItem>
          </>
        }
      />
      <WorkflowFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        mode='edit'
        workflow={{
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          icon: workflow.icon,
        }}
      />
      <DuplicateWorkflowDialog
        open={duplicateDialogOpen}
        onOpenChange={setDuplicateDialogOpen}
        workflowId={workflow.id}
        workflowName={workflow.name}
      />
    </>
  )
}

export function WorkflowsGridView() {
  const { workflows } = useWorkflows()

  return (
    <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
      {workflows.map((workflow) => (
        <WorkflowCard key={workflow.id} workflow={workflow} />
      ))}
    </div>
  )
}
