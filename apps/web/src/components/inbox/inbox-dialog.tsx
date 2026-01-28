// apps/web/src/components/inbox/inbox-dialog.tsx
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import {
  Field,
  FieldLabel,
  FieldGroup,
} from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Button } from '@auxx/ui/components/button'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { Label } from '@auxx/ui/components/label'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { FormColorTagPicker } from '~/components/pickers/color-tag-picker'
import { MemberGroupFormField } from '~/components/pickers/member-group-form-picker'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { useForm } from 'react-hook-form'
import { Form } from '@auxx/ui/components/form'
import type { InboxVisibility } from '@auxx/lib/inboxes'
import { useRecord, parseRecordId, type RecordId, type RecordMeta } from '~/components/resources'

/** Inbox record shape for useRecord */
interface InboxRecord extends RecordMeta {
  name: string
  description: string | null
  color: string | null
}

/** Props for InboxDialog */
interface InboxDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** RecordId for edit mode, null/undefined for create mode */
  recordId?: RecordId | null
  /** Called after successful save */
  onSuccess?: (inbox: { id: string; name: string }) => void
}

/** Form data for create mode */
interface CreateInboxFormData {
  name: string
  description: string
  color: string
  accessType: 'anyone' | 'restricted'
  memberGroupSelection: {
    memberIds: string[]
    groupIds: string[]
  }
}

/** Form data for edit mode */
interface EditInboxFormData {
  name: string
  description: string
  color: string
}

/** Dialog for creating and editing inboxes */
export function InboxDialog({
  open,
  onOpenChange,
  recordId,
  onSuccess,
}: InboxDialogProps) {
  // Determine if editing based on prop
  const isEditing = !!recordId

  // Extract inboxId from recordId for mutations
  const inboxId = recordId ? parseRecordId(recordId).entityInstanceId : null

  // Fetch inbox data for edit mode using useRecord
  const { record: inbox, isLoading: isInboxLoading, isNotFound } = useRecord<InboxRecord>({
    recordId: recordId ?? undefined,
    enabled: isEditing && open,
  })

  // Handle case where inbox is not found when editing
  useEffect(() => {
    if (open && recordId && !isInboxLoading && isNotFound) {
      toastError({
        title: 'Inbox not found',
        description: 'The inbox may have been deleted.',
      })
      onOpenChange(false)
    }
  }, [open, recordId, isInboxLoading, isNotFound, onOpenChange])

  // Form setup
  const form = useForm<CreateInboxFormData>({
    defaultValues: {
      name: '',
      description: '',
      color: '#4F46E5',
      accessType: 'anyone',
      memberGroupSelection: { memberIds: [], groupIds: [] },
    },
  })

  // Watch form values
  const colorValue = form.watch('color')
  const accessType = form.watch('accessType')

  // Combined form values for dirty checking
  const formValues = useMemo(
    () => ({
      name: form.watch('name'),
      description: form.watch('description'),
      color: colorValue,
      accessType: isEditing ? undefined : accessType,
    }),
    [form.watch('name'), form.watch('description'), colorValue, accessType, isEditing]
  )

  // Track dirty state for unsaved changes warning
  const { isDirty, setInitial } = useDirtyCheck(formValues)

  // Stable callback for closing the dialog
  const handleConfirmedClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  // Guard against accidental close when dirty
  const { guardProps, guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: handleConfirmedClose,
  })

  // Reset form when dialog opens/closes or editing inbox changes
  useEffect(() => {
    if (open) {
      if (isEditing && inbox) {
        // Edit mode: populate from inbox data
        form.reset({
          name: inbox.name,
          description: inbox.description || '',
          color: inbox.color || '#4F46E5',
          accessType: 'anyone',
          memberGroupSelection: { memberIds: [], groupIds: [] },
        })
        setInitial({
          name: inbox.name,
          description: inbox.description || '',
          color: inbox.color || '#4F46E5',
          accessType: undefined,
        })
      } else if (!isEditing) {
        // Create mode: reset to defaults
        form.reset({
          name: '',
          description: '',
          color: '#4F46E5',
          accessType: 'anyone',
          memberGroupSelection: { memberIds: [], groupIds: [] },
        })
        setInitial({
          name: '',
          description: '',
          color: '#4F46E5',
          accessType: 'anyone',
        })
      }
    }
  }, [open, isEditing, inbox, form, setInitial])

  // Get tRPC utils for cache invalidation
  const utils = api.useUtils()

  // Create inbox mutation
  const createInbox = api.inbox.create.useMutation({
    onSuccess: (data) => {
      utils.inbox.getAll.invalidate()
      onOpenChange(false)
      onSuccess?.({ id: data.id, name: data.name })
    },
    onError: (error) => {
      toastError({ title: 'Error creating inbox', description: error.message })
    },
  })

  // Update inbox mutation
  const updateInbox = api.inbox.update.useMutation({
    onSuccess: () => {
      utils.inbox.getAll.invalidate()
      utils.inbox.getById.invalidate({ inboxId: inboxId! })
      onOpenChange(false)
      onSuccess?.({ id: inboxId!, name: form.getValues('name') })
    },
    onError: (error) => {
      toastError({ title: 'Error updating inbox', description: error.message })
    },
  })

  const isPending = createInbox.isPending || updateInbox.isPending

  // Form validation
  const isValid = (form.watch('name') ?? '').trim().length > 0

  // Handle color change from the color picker
  const handleColorChange = (color: string) => {
    form.setValue('color', color)
  }

  // Handle form submission
  const handleSubmit = (data: CreateInboxFormData) => {
    if (!isValid) return

    if (isEditing && inboxId) {
      updateInbox.mutate({
        inboxId,
        data: {
          name: data.name.trim(),
          description: data.description,
          color: data.color,
        },
      })
    } else {
      // Map accessType to visibility
      const visibility: InboxVisibility = data.accessType === 'anyone' ? 'org_members' : 'custom'
      createInbox.mutate({
        name: data.name.trim(),
        description: data.description,
        color: data.color,
        status: 'ACTIVE',
        visibility,
      })
    }
  }

  // Don't render content while loading in edit mode
  if (isEditing && isInboxLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="sm" position="tc">
          <DialogHeader>
            <DialogTitle>Loading...</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="sm" position="tc" {...guardProps}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Inbox' : 'Create Inbox'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update inbox settings.'
                : 'Create a new inbox to organize your messages.'}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)}>
              <FieldGroup className="gap-4">
                {/* Name field */}
                <Field>
                  <FieldLabel>Name</FieldLabel>
                  <Input
                    {...form.register('name', { required: 'Name is required' })}
                    placeholder="Enter inbox name"
                  />
                  {form.formState.errors.name && (
                    <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
                  )}
                </Field>

                {/* Description field */}
                <Field>
                  <FieldLabel>Description</FieldLabel>
                  <Textarea
                    {...form.register('description')}
                    placeholder="Optional description"
                    rows={3}
                  />
                </Field>

                {/* Color field */}
                <Field>
                  <FieldLabel>Color</FieldLabel>
                  <FormColorTagPicker value={colorValue} onChange={handleColorChange} />
                </Field>

                {/* Access fields - only show in create mode */}
                {!isEditing && (
                  <>
                    <Field>
                      <FieldLabel>Access</FieldLabel>
                      <RadioGroup
                        value={accessType}
                        onValueChange={(value) =>
                          form.setValue('accessType', value as 'anyone' | 'restricted')
                        }
                        className="mt-2 flex flex-col space-y-2">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="anyone" id="anyone" />
                          <Label htmlFor="anyone" className="cursor-pointer">
                            Anyone in the organization
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="restricted" id="restricted" />
                          <Label htmlFor="restricted" className="cursor-pointer">
                            Restricted
                          </Label>
                        </div>
                      </RadioGroup>
                    </Field>

                    {accessType === 'restricted' && (
                      <div className="pl-6">
                        <MemberGroupFormField
                          name="memberGroupSelection"
                          control={form.control}
                          label="Select members or groups with access"
                          description="Only selected members and groups will have access to this inbox"
                          disabled={isPending}
                        />
                      </div>
                    )}
                  </>
                )}
              </FieldGroup>

              <DialogFooter>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={guardedClose}
                  disabled={isPending}>
                  Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  type="submit"
                  loading={isPending}
                  loadingText="Saving..."
                  disabled={!isValid || isPending}>
                  {isEditing ? 'Update Inbox' : 'Create Inbox'} <KbdSubmit variant="outline" size="sm" />
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </>
  )
}
