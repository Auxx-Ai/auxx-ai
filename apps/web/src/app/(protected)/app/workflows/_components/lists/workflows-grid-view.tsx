// apps/web/src/app/(protected)/app/workflows/_components/lists/workflows-grid-view.tsx
'use client'

import { TRIGGER_NAME_MAP, type WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
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
import {
  Copy,
  Edit,
  MoreHorizontal,
  MoreVertical,
  Pause,
  Play,
  TestTube,
  Trash,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { TooltipExplanation } from '~/components/global/tooltip'
import { DuplicateWorkflowDialog } from '~/components/workflow/dialogs/duplicate-workflow-dialog'
import { WorkflowFormDialog } from '~/components/workflow/dialogs/workflow-form-dialog'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useWorkflows } from '../providers/workflows-provider'
import { getTriggerInfo } from '../utils/trigger-info'

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

  const getStatusColor = (executions: any[]) => {
    if (!executions || executions.length === 0) return 'gray'
    const latest = executions[0]
    switch (latest.status) {
      case 'SUCCEEDED':
        return 'green'
      case 'FAILED':
        return 'red'
      case 'RUNNING':
        return 'blue'
      default:
        return 'gray'
    }
  }
  return (
    <>
      <ConfirmDialog />
      <Card
        className='group/workflow-card hover:shadow-md  transition-shadow cursor-pointer relative'
        onClick={handleCardClick}>
        <CardHeader>
          <div className='flex items-start justify-between'>
            <div className='relative'>
              {workflow.icon ? (
                <EntityIcon
                  iconId={workflow.icon.iconId}
                  color={workflow.icon.color}
                  size='default'
                />
              ) : (
                <div
                  className={`p-2 rounded-lg ${workflow.enabled ? 'bg-good-100 text-good-500' : 'bg-primary-100 text-primary-500'}`}>
                  {unifiedNodeRegistry.getNodeIcon(workflow.triggerType, 'size-4')}
                </div>
              )}
              <div className='absolute -top-1 -right-1'>
                {workflow.executions && workflow.executions.length > 0 && (
                  <div className='flex items-center gap-2'>
                    <div
                      className={`size-2.5 rounded-full bg-${getStatusColor(workflow.executions)}-500 flex-shrink-0`}
                    />
                    {/* <LastUpdated timestamp={workflow.executions[0].createdAt} className="text-xs" /> */}
                  </div>
                )}
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className='opacity-0 group-hover/workflow-card:opacity-100 duration-300 data-[state=open]:opacity-100! data-[state=open]:bg-muted! transition-opacity rounded-full absolute top-0.5 right-0.5'
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

          <CardTitle className='text-sm'>
            <div className='flex justify-between items-center'>
              <span className='group-hover/workflow-card:text-info flex flex-row gap-1 truncate'>
                {workflow.name}
                {workflow.description && (
                  <TooltipExplanation text={workflow.description}></TooltipExplanation>
                )}
              </span>
              <Badge variant='pill' size='sm'>
                {TRIGGER_NAME_MAP[workflow.triggerType as WorkflowTriggerType] || 'Unknown'}
              </Badge>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent>
          {/* Trigger and Status */}
          <div className='flex items-center justify-between'></div>

          {/* Stats */}
          <div className='flex items-center justify-between text-xs text-muted-foreground'>
            <div className='flex items-center gap-3'>
              {workflow._count?.workflows > 1 && <span>{workflow._count.workflows} versions</span>}
              <span>{workflow._count?.executions || 0} executions</span>
            </div>
          </div>

          {/* Last Updated */}
          <LastUpdated
            timestamp={workflow.updatedAt}
            prefix='Last updated'
            includeSeconds={true}
            className='text-xs text-muted-foreground'
          />
        </CardContent>
      </Card>
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
