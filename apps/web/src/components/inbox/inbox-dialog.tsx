// apps/web/src/components/inbox/inbox-dialog.tsx
'use client'

import type { InboxVisibility } from '@auxx/lib/inboxes'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Field, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import { Form } from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { FormColorTagPicker } from '~/components/pickers/color-tag-picker'
import { MemberGroupFormField } from '~/components/pickers/member-group-form-picker'
import { useSaveSystemValues, useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { api } from '~/trpc/react'

/** Props for InboxDialog */
interface InboxDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** RecordId for edit mode, null/undefined for create mode */
  recordId?: RecordId | null
  /** Called after successful save */
  onSuccess?: (inbox: { id: string; name: string }) => void
}

/** Form data for inbox dialog */
interface InboxFormData {
  name: string
  description: string
  color: string
  accessType: 'anyone' | 'restricted'
  memberGroupSelection: {
    memberIds: string[]
    groupIds: string[]
  }
}

/** Dialog for creating and editing inboxes */
export function InboxDialog({ open, onOpenChange, recordId, onSuccess }: InboxDialogProps) {
  // Determine if editing based on prop
  const isEditing = !!recordId

  // Extract inboxId from recordId for mutations
  const inboxId = recordId ? parseRecordId(recordId).entityInstanceId : null

  // Fetch inbox data directly for edit mode
  // const { data: inboxData } = api.inbox.getById.useQuery(
  //   { inboxId: inboxId! },
  //   { enabled: isEditing && !!inboxId }
  // )

  // Fetch system field values for edit mode
  const { values: fieldValues, isLoading: isLoadingValues } = useSystemValues(
    recordId,
    ['inbox_name', 'inbox_description', 'inbox_color', 'inbox_visibility'],
    { autoFetch: true, enabled: isEditing && !!recordId }
  )

  // Save system values with optimistic updates
  const { save: saveSystemValues, isPending: isSavingValues } = useSaveSystemValues(recordId)

  // Track if form has been initialized this open cycle
  const isInitialized = useRef(false)

  // Form setup
  const form = useForm<InboxFormData>({
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
      accessType,
    }),
    [form.watch('name'), form.watch('description'), colorValue, accessType]
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

  // Initialize form when dialog opens (only once per cycle)
  useEffect(() => {
    if (open) {
      // Skip if already initialized
      if (isInitialized.current) return

      if (isEditing && recordId) {
        // In edit mode, wait for values to load (inbox_name is required)
        if (isLoadingValues || fieldValues.inbox_name === undefined) return

        isInitialized.current = true

        const name = (fieldValues.inbox_name as string) ?? ''
        const description = (fieldValues.inbox_description as string) ?? ''
        const color = (fieldValues.inbox_color as string) ?? '#4F46E5'
        const visibility = fieldValues.inbox_visibility ?? 'org_members'
        const accessType = visibility === 'org_members' ? 'anyone' : 'restricted'

        form.reset({
          name,
          description,
          color,
          accessType,
          memberGroupSelection: { memberIds: [], groupIds: [] },
        })
        setInitial({ name, description, color, accessType })
      } else {
        // Create mode: reset to defaults
        isInitialized.current = true

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
    } else {
      // Reset flag when dialog closes
      isInitialized.current = false
    }
  }, [open, isEditing, recordId, fieldValues, isLoadingValues, form, setInitial])

  // Get tRPC utils for cache invalidation
  const utils = api.useUtils()

  // Confirmation dialog for delete
  const [confirm, ConfirmDeleteDialog] = useConfirm()

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

  // Delete inbox mutation
  const deleteInbox = api.inbox.delete.useMutation({
    onSuccess: () => {
      utils.inbox.getAll.invalidate()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Error deleting inbox', description: error.message })
    },
  })

  const isPending = createInbox.isPending || isSavingValues || deleteInbox.isPending

  // Form validation
  const isValid = (form.watch('name') ?? '').trim().length > 0

  // Handle color change from the color picker
  const handleColorChange = (color: string) => {
    form.setValue('color', color)
  }

  // Handle delete with confirmation
  const handleDelete = async () => {
    if (!inboxId) return

    const confirmed = await confirm({
      title: 'Delete inbox?',
      description:
        'This will permanently delete this inbox and all its settings. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteInbox.mutate({ inboxId })
    }
  }

  // Handle form submission
  const handleSubmit = async (data: InboxFormData) => {
    if (!isValid) return

    const visibility: InboxVisibility = data.accessType === 'anyone' ? 'org_members' : 'custom'

    if (isEditing && recordId) {
      // Save field values with optimistic updates
      const success = await saveSystemValues({
        inbox_name: data.name.trim(),
        inbox_description: data.description,
        inbox_color: data.color,
        inbox_visibility: visibility,
      })

      if (success) {
        onOpenChange(false)
        onSuccess?.({ id: inboxId!, name: data.name })
      }
    } else {
      createInbox.mutate({
        name: data.name.trim(),
        description: data.description,
        color: data.color,
        status: 'ACTIVE',
        visibility,
      })
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size='sm' position='tc' {...guardProps}>
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
              <FieldGroup className='gap-4'>
                {/* Name field */}
                <Field>
                  <FieldLabel>Name</FieldLabel>
                  <Input
                    {...form.register('name', { required: 'Name is required' })}
                    placeholder='Enter inbox name'
                  />
                  {form.formState.errors.name && (
                    <p className='text-sm text-destructive'>{form.formState.errors.name.message}</p>
                  )}
                </Field>

                {/* Description field */}
                <Field>
                  <FieldLabel>Description</FieldLabel>
                  <Textarea
                    {...form.register('description')}
                    placeholder='Optional description'
                    rows={3}
                  />
                </Field>

                {/* Color field */}
                <Field>
                  <FieldLabel>Color</FieldLabel>
                  <FormColorTagPicker value={colorValue} onChange={handleColorChange} />
                </Field>

                {/* Access fields */}
                <Field>
                  <FieldLabel>Access</FieldLabel>
                  <RadioGroup
                    value={accessType}
                    onValueChange={(value) =>
                      form.setValue('accessType', value as 'anyone' | 'restricted')
                    }
                    className='mt-2 flex flex-col space-y-2'>
                    <div className='flex items-center space-x-2'>
                      <RadioGroupItem value='anyone' id='anyone' />
                      <Label htmlFor='anyone' className='cursor-pointer'>
                        Anyone in the organization
                      </Label>
                    </div>
                    <div className='flex items-center space-x-2'>
                      <RadioGroupItem value='restricted' id='restricted' />
                      <Label htmlFor='restricted' className='cursor-pointer'>
                        Restricted
                      </Label>
                    </div>
                  </RadioGroup>
                </Field>

                {accessType === 'restricted' && (
                  <div className='pl-6'>
                    <MemberGroupFormField
                      name='memberGroupSelection'
                      control={form.control}
                      label='Select members or groups with access'
                      description='Only selected members and groups will have access to this inbox'
                      disabled={isPending}
                    />
                  </div>
                )}
              </FieldGroup>

              <DialogFooter className='flex sm:justify-between!'>
                {isEditing ? (
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    onClick={handleDelete}
                    disabled={isPending}
                    className='text-destructive hover:text-destructive'>
                    <Trash2 /> Delete
                  </Button>
                ) : (
                  <div />
                )}
                <div className='flex gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    onClick={guardedClose}
                    disabled={isPending}>
                    Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    type='submit'
                    loading={isPending}
                    loadingText='Saving...'
                    disabled={!isValid || isPending}>
                    {isEditing ? 'Update Inbox' : 'Create Inbox'}{' '}
                    <KbdSubmit variant='outline' size='sm' />
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
      <ConfirmDeleteDialog />
    </>
  )
}
