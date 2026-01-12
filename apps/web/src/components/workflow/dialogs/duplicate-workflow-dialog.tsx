// apps/web/src/components/workflow/dialogs/duplicate-workflow-dialog.tsx

'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'

interface DuplicateWorkflowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  workflowName: string
}

/**
 * Dialog for duplicating a workflow with a new name
 */
export function DuplicateWorkflowDialog({
  open,
  onOpenChange,
  workflowId,
  workflowName,
}: DuplicateWorkflowDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DuplicateWorkflowDialogContent
          workflowId={workflowId}
          workflowName={workflowName}
          open={open}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Inner content props */
interface DuplicateWorkflowDialogContentProps {
  workflowId: string
  workflowName: string
  open: boolean
  onClose: () => void
}

/** Inner content component */
function DuplicateWorkflowDialogContent({
  workflowId,
  workflowName,
  open,
  onClose,
}: DuplicateWorkflowDialogContentProps) {
  const router = useRouter()
  const [name, setName] = useState('')

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName(`${workflowName} (Copy)`)
    }
  }, [open, workflowName])

  const duplicateWorkflow = api.workflow.duplicate.useMutation({
    onSuccess: (newWorkflow) => {
      toastSuccess({ description: 'Workflow duplicated' })
      onClose()
      router.push(`/app/workflows/${newWorkflow.id}`)
    },
    onError: (error) => {
      toastError({ title: 'Failed to duplicate workflow', description: error.message })
    },
  })

  /** Handle form submission */
  const handleDuplicate = () => {
    if (!name.trim()) return
    duplicateWorkflow.mutate({ id: workflowId, name: name.trim() })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Duplicate Workflow</DialogTitle>
        <DialogDescription>Create a copy of this workflow with a new name.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter workflow name"
          autoFocus
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDuplicate}
          loading={duplicateWorkflow.isPending}
          loadingText="Duplicating..."
          disabled={!name.trim() || duplicateWorkflow.isPending}
          data-dialog-submit>
          Duplicate <KbdSubmit variant="outline" size="sm" />
        </Button>
      </DialogFooter>
    </>
  )
}
