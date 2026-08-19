// apps/web/src/components/workflow/dialogs/workflow-form-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { IconPicker, type IconPickerValue } from '@auxx/ui/components/icon-picker'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'

interface WorkflowFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflow: {
    id: string
    name: string
    description?: string | null
    icon?: { iconId: string; color: string } | null
  }
}

/** Shown when a workflow has no icon of its own. */
const DEFAULT_ICON: IconPickerValue = { icon: 'zap', color: 'blue' }

/**
 * Edit a workflow's name, description and icon.
 *
 * Edit-only by design: creating from scratch no longer asks for any of this —
 * `useCreateWorkflow` posts an empty create and the server mints an "Untitled
 * workflow" name plus a starter icon, so the user lands on the canvas straight
 * away. This dialog is how they fix those later, reached from the builder
 * header's Settings button, the breadcrumb switcher, and the list rows.
 */
export function WorkflowFormDialog({ open, onOpenChange, workflow }: WorkflowFormDialogProps) {
  const utils = api.useUtils()

  const nameInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [iconValue, setIconValue] = useState<IconPickerValue>(DEFAULT_ICON)

  // Reset the form to the workflow's stored values each time the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: workflow fields are intentionally excluded so a background refetch can't clobber in-flight edits
  useEffect(() => {
    if (open) {
      setName(workflow.name)
      setDescription(workflow.description ?? '')
      setIconValue(
        workflow.icon ? { icon: workflow.icon.iconId, color: workflow.icon.color } : DEFAULT_ICON
      )
    }
  }, [open])

  const updateWorkflow = api.workflow.update.useMutation({
    onSuccess: () => {
      onOpenChange(false)
      // Invalidate to refresh the workflow data in the UI. `list` matters too:
      // the breadcrumb switcher renames from a row, so its own list must repaint.
      void utils.workflow.getById.invalidate({ id: workflow.id })
      void utils.workflow.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update workflow', description: error.message })
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toastError({ title: 'Name required', description: 'Please enter a workflow name' })
      return
    }

    await updateWorkflow.mutateAsync({
      id: workflow.id,
      name: name.trim(),
      description: description.trim(),
      icon: { iconId: iconValue.icon, color: iconValue.color },
    })
  }

  const isPending = updateWorkflow.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='sm:max-w-[425px]'
        position='tc'
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          nameInputRef.current?.focus()
        }}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Workflow</DialogTitle>
            <DialogDescription>Update the name and description of your workflow.</DialogDescription>
          </DialogHeader>

          <div className='grid gap-4'>
            <div className='grid gap-2'>
              <Label htmlFor='name'>Name</Label>
              <InputGroup>
                <InputGroupAddon align='inline-start' className='ml-1'>
                  <IconPicker
                    value={iconValue}
                    onChange={setIconValue}
                    className='size-6'></IconPicker>
                </InputGroupAddon>
                <InputGroupInput
                  ref={nameInputRef}
                  id='name'
                  autoComplete='off'
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder='Enter workflow name'
                  disabled={isPending}
                  required
                />
              </InputGroup>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='description'>Description</Label>
              <Textarea
                id='description'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder='Enter workflow description (optional)'
                className='min-h-[250px]'
                disabled={isPending}
                rows={3}
              />
            </div>
            {updateWorkflow.error && (
              <div className='text-sm text-destructive'>{updateWorkflow.error.message}</div>
            )}
          </div>

          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => onOpenChange(false)}
              disabled={isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              type='submit'
              variant='outline'
              size='sm'
              loading={isPending}
              loadingText='Saving...'>
              Save Changes <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
