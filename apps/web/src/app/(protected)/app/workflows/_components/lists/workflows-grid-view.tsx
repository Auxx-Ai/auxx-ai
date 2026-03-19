// apps/web/src/app/(protected)/app/workflows/_components/lists/workflows-grid-view.tsx
'use client'

import { TRIGGER_NAME_MAP, type WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Copy, Edit, MoreVertical, Pause, Play, TestTube, Trash } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
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
  const router = useRouter()
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

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()

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

  const handleCardClick = () => {
    router.push(`/app/workflows/${workflow.id}`)
  }

  const handleDropdownClick = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditDialogOpen(true)
  }

  const handleDuplicateClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDuplicateDialogOpen(true)
  }

  return (
    <>
      <ConfirmDialog />
      <div
        className='rounded-2xl bg-primary-50 hover:bg-primary-50/50 hover:outline-5 hover:outline-primary-50 flex flex-col p-3 gap-2 border cursor-pointer group/workflow-card relative'
        onClick={handleCardClick}>
        {/* Top row: Icon + Title + Badge */}
        <div className='flex flex-row items-start gap-2 w-full'>
          <div className='relative shrink-0'>
            <div className='size-8 rounded-xl border flex items-center justify-center overflow-hidden'>
              {workflow.icon ? (
                <EntityIcon
                  iconId={workflow.icon.iconId}
                  color={workflow.icon.color}
                  size='default'
                />
              ) : (
                unifiedNodeRegistry.getNodeIcon(workflow.triggerType, 'size-4')
              )}
            </div>
            <Tooltip content={workflow.enabled ? 'Enabled' : 'Disabled'}>
              <div
                className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-primary-50 ${workflow.enabled ? 'bg-good-500' : 'bg-muted-foreground/40'}`}
              />
            </Tooltip>
          </div>

          <div className='flex flex-col flex-1 min-w-0'>
            <div className='flex flex-row justify-between items-start gap-1'>
              <p className='text-sm font-semibold line-clamp-2 group-hover/workflow-card:text-info'>
                {workflow.name}
              </p>
              <Badge variant='pill' size='sm' className='shrink-0 mt-0.5'>
                {TRIGGER_NAME_MAP[workflow.triggerType as WorkflowTriggerType] || 'Unknown'}
              </Badge>
            </div>
            <LastUpdated
              timestamp={workflow.updatedAt}
              prefix=''
              includeSeconds={true}
              className='text-xs text-muted-foreground'
            />
          </div>
        </div>

        {/* Bottom row: Executions + Dropdown */}
        <div className='flex items-center justify-between mt-auto'>
          <div className='flex items-center gap-3 text-xs text-muted-foreground'>
            {workflow._count?.workflows > 1 && <span>{workflow._count.workflows} versions</span>}
            <span>{workflow._count?.executions || 0} executions</span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className='opacity-0 group-hover/workflow-card:opacity-100 duration-300 data-[state=open]:opacity-100! data-[state=open]:bg-muted! transition-opacity rounded-lg'
                variant='ghost'
                size='icon-xs'
                onClick={handleDropdownClick}>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={handleEditClick}>
                <Edit />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/app/workflows/${workflow.id}/test`}>
                  <TestTube />
                  Test
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDuplicateClick}>
                <Copy />
                Duplicate
              </DropdownMenuItem>
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
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
