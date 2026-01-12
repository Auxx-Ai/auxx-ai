// apps/web/src/components/workflow/dialogs/workflow-form-dialog.tsx

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
import { useDialogSubmit } from '@auxx/ui/hooks'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { EntityIcon } from '@auxx/ui/components/icons'
import { IconPicker, type IconPickerValue } from '@auxx/ui/components/icon-picker'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'

/**
 * Props type for WorkflowFormDialog using discriminated union
 * Ensures workflow data is required when mode is 'edit'
 */
type WorkflowFormDialogProps =
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: 'create'
    }
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: 'edit'
      workflow: {
        id: string
        name: string
        description?: string | null
        icon?: { iconId: string; color: string } | null
      }
    }

/** Default icon value for new workflows */
const DEFAULT_ICON: IconPickerValue = { icon: 'workflow', color: 'blue' }

/**
 * Dialog for creating new workflows or editing existing workflow metadata
 * Supports both create and edit modes with type-safe props
 */
export function WorkflowFormDialog(props: WorkflowFormDialogProps) {
  const { open, onOpenChange } = props
  const router = useRouter()
  const utils = api.useUtils()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [iconValue, setIconValue] = useState<IconPickerValue>(DEFAULT_ICON)

  // Reset form when dialog opens with appropriate values
  useEffect(() => {
    if (open) {
      if (props.mode === 'edit') {
        setName(props.workflow.name)
        setDescription(props.workflow.description ?? '')
        setIconValue(
          props.workflow.icon
            ? { icon: props.workflow.icon.iconId, color: props.workflow.icon.color }
            : DEFAULT_ICON
        )
      } else {
        setName('')
        setDescription('')
        setIconValue(DEFAULT_ICON)
      }
    }
  }, [open, props.mode])

  const createWorkflow = api.workflow.create.useMutation({
    onSuccess: () => {
      // Close dialog and reset form
      onOpenChange(false)
      setName('')
      setDescription('')
      setIconValue(DEFAULT_ICON)
    },
    onError: (error) => {
      toastError({ title: 'Failed to create workflow', description: error.message })
    },
  })

  const updateWorkflow = api.workflow.update.useMutation({
    onSuccess: () => {
      onOpenChange(false)
      setName('')
      setDescription('')
      setIconValue(DEFAULT_ICON)
      // Invalidate to refresh the workflow data in the UI
      if (props.mode === 'edit') {
        void utils.workflow.getById.invalidate({ id: props.workflow.id })
      }
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

    const iconData = { iconId: iconValue.icon, color: iconValue.color }

    if (props.mode === 'create') {
      const result = await createWorkflow.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        enabled: false,
        icon: iconData,
      })

      if (result?.id) {
        router.push(`/app/workflows/${result.id}`)
      }
    } else {
      await updateWorkflow.mutateAsync({
        id: props.workflow.id,
        name: name.trim(),
        description: description.trim(),
        icon: iconData,
      })
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
    setName('')
    setDescription('')
    setIconValue(DEFAULT_ICON)
  }

  // Dynamic UI text based on mode
  const isPending = props.mode === 'create' ? createWorkflow.isPending : updateWorkflow.isPending

  const dialogTitle = props.mode === 'create' ? 'Create New Workflow' : 'Edit Workflow'

  const dialogDescription =
    props.mode === 'create'
      ? 'Create a new workflow to automate your business processes.'
      : 'Update the name and description of your workflow.'

  const submitButtonText = props.mode === 'create' ? 'Create Workflow' : 'Save Changes'

  const loadingText = props.mode === 'create' ? 'Creating...' : 'Saving...'

  const error = props.mode === 'create' ? createWorkflow.error : updateWorkflow.error

  // Register Meta+Enter submit handler
  const { formProps } = useDialogSubmit({
    onSubmit: handleSubmit,
    disabled: isPending,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" position="tc">
        <form {...formProps}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <InputGroup>
                <InputGroupAddon align="inline-start" className="ml-1">
                  <IconPicker
                    value={iconValue}
                    onChange={setIconValue}
                    className="size-6"></IconPicker>
                </InputGroupAddon>
                <InputGroupInput
                  id="name"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter workflow name"
                  disabled={isPending}
                  required
                />
              </InputGroup>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter workflow description (optional)"
                className="min-h-[250px]"
                disabled={isPending}
                rows={3}
              />
            </div>
            {error && <div className="text-sm text-destructive">{error.message}</div>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isPending}>
              Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
            </Button>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              loading={isPending}
              loadingText={loadingText}>
              {submitButtonText} <KbdSubmit variant="outline" size="sm" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
