// apps/web/src/app/(protected)/app/workflows/_components/lists/workflows-table-view.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { TRIGGER_NAME_MAP, type WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Switch } from '@auxx/ui/components/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Copy, Edit, ExternalLink, MoreHorizontal, TestTube, Trash } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { WorkflowFormDialog } from '~/components/workflow/dialogs/workflow-form-dialog'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useWorkflows } from '../providers/workflows-provider'

export function WorkflowsTableView() {
  const { workflows, refetchWorkflows } = useWorkflows()
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [selectedWorkflow, setSelectedWorkflow] = useState<{
    id: string
    name: string
    description?: string | null
    icon?: { iconId: string; color: string } | null
  } | null>(null)

  // Per-workflow instance access (plan 30 §4). Rename / enable-disable / delete
  // are `admin`; Test is an authoring action (`edit`); View stays at `view`.
  // Duplicate additionally CREATES, so it needs the coarse manage key too.
  const { can, canAdminInstance, canEditInstance } = useAccess()
  const canCreate = can(PermissionKey.workflowsManage)

  const updateWorkflow = api.workflow.update.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Workflow updated' })
      refetchWorkflows()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update workflow', description: error.message })
    },
  })

  const deleteWorkflow = api.workflow.delete.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Workflow deleted' })
      refetchWorkflows()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete workflow', description: error.message })
    },
  })

  const handleToggleEnabled = async (workflowId: string, currentEnabled: boolean) => {
    await updateWorkflow.mutateAsync({ id: workflowId, enabled: !currentEnabled })
  }

  const handleDelete = async (workflowId: string) => {
    if (window.confirm('Are you sure you want to delete this workflow?')) {
      await deleteWorkflow.mutateAsync({ id: workflowId })
    }
  }

  const handleEditClick = (workflow: {
    id: string
    name: string
    description?: string | null
    icon?: { iconId: string; color: string } | null
  }) => {
    setSelectedWorkflow(workflow)
    setEditDialogOpen(true)
  }

  return (
    <div className='border rounded-lg'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className='w-[50px]'></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workflows.map((workflow) => {
            const recordId = toRecordId('workflow', workflow.id)
            const canAdmin = canAdminInstance(recordId)
            const canEdit = canEditInstance(recordId)
            return (
              <TableRow key={workflow.id}>
                <TableCell className='w-max'>
                  <div>
                    <Link
                      href={`/app/workflows/${workflow.id}`}
                      className='font-medium hover:text-info hover:underline'>
                      {workflow.name}
                    </Link>
                    {workflow.description && (
                      <div className='text-sm text-muted-foreground truncate max-w-xs'>
                        {workflow.description}
                      </div>
                    )}
                  </div>
                </TableCell>

                <TableCell>
                  <Badge className='shrink-0 truncate' variant='outline'>
                    {TRIGGER_NAME_MAP[workflow.triggerType as WorkflowTriggerType] || 'Unknown'}
                  </Badge>
                </TableCell>

                <TableCell>
                  {canAdmin ? (
                    <Switch
                      size='sm'
                      checked={workflow.enabled}
                      onCheckedChange={() => handleToggleEnabled(workflow.id, workflow.enabled)}
                      disabled={updateWorkflow.isPending}
                    />
                  ) : (
                    <Badge variant={workflow.enabled ? 'green' : 'gray'} size='sm'>
                      {workflow.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  )}
                </TableCell>

                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='icon-sm'>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem asChild>
                        <Link href={`/app/workflows/${workflow.id}`}>
                          <ExternalLink />
                          View
                        </Link>
                      </DropdownMenuItem>
                      {canAdmin && (
                        <DropdownMenuItem
                          onClick={() =>
                            handleEditClick({
                              id: workflow.id,
                              name: workflow.name,
                              description: workflow.description,
                              // Carry the icon through: the dialog saves
                              // whatever its picker holds, so dropping it here
                              // resets the workflow's icon on every rename.
                              icon: workflow.icon,
                            })
                          }>
                          <Edit />
                          Edit
                        </DropdownMenuItem>
                      )}
                      {canEdit && (
                        <DropdownMenuItem asChild>
                          <Link href={`/app/workflows/${workflow.id}/test`}>
                            <TestTube />
                            Test
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {canAdmin && canCreate && (
                        <DropdownMenuItem>
                          <Copy />
                          Duplicate
                        </DropdownMenuItem>
                      )}
                      {canAdmin && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDelete(workflow.id)}
                            variant='destructive'>
                            <Trash />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {selectedWorkflow && (
        <WorkflowFormDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          workflow={selectedWorkflow}
        />
      )}
    </div>
  )
}
