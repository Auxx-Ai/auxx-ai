// apps/web/src/components/inbox/inbox-dialog.tsx
'use client'

import { useEffect, useCallback, useMemo, useRef } from 'react'
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
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { useResourceFields } from '~/components/resources/hooks'
import { useFieldValueSyncer } from '~/components/resources/hooks/use-field-value-syncer'
import { formatToRawValue } from '@auxx/lib/field-values/client'


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

  // Get field definitions for inboxes
  const { fields } = useResourceFields('inboxes')

  // Get specific fields we need
  const editableFields = useMemo(() => {
    return fields.filter(
      (f) =>
        ['name', 'description', 'color', 'visibility'].includes(f.key ?? '') &&
        f.capabilities?.updatable !== false
    )
  }, [fields])

  // Build arrays for syncer
  const recordIds = useMemo(() => (recordId ? [recordId] : []), [recordId])
  const resourceFieldIds = useMemo(
    () => editableFields.map((f) => f.resourceFieldId!).filter(Boolean),
    [editableFields]
  )

  // Sync field values from store
  const { getValue } = useFieldValueSyncer({
    recordIds,
    resourceFieldIds,
    columnVisibility: {},
    enabled: isEditing && resourceFieldIds.length > 0,
  })

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

      // In edit mode, wait for fields to be ready
      if (isEditing && editableFields.length === 0) return

      isInitialized.current = true

      if (isEditing && recordId) {
        // Edit mode: get values from field value store
        const nameField = editableFields.find((f) => f.key === 'name')
        const descField = editableFields.find((f) => f.key === 'description')
        const colorField = editableFields.find((f) => f.key === 'color')
        const visibilityField = editableFields.find((f) => f.key === 'visibility')

        const name = nameField?.resourceFieldId ? getValue(recordId, nameField.resourceFieldId) : ''
        const description = descField?.resourceFieldId
          ? getValue(recordId, descField.resourceFieldId)
          : ''
        const color = colorField?.resourceFieldId
          ? getValue(recordId, colorField.resourceFieldId)
          : '#4F46E5'
        const visibility = visibilityField?.resourceFieldId
          ? getValue(recordId, visibilityField.resourceFieldId)
          : 'org_members'

        const accessType = visibility === 'org_members' ? 'anyone' : 'restricted'

        form.reset({
          name: (formatToRawValue(name, 'TEXT') as string) ?? '',
          description: (formatToRawValue(description, 'RICH_TEXT') as string) ?? '',
          color: (formatToRawValue(color, 'TEXT') as string) ?? '#4F46E5',
          accessType,
          memberGroupSelection: { memberIds: [], groupIds: [] },
        })
        setInitial({
          name: (formatToRawValue(name, 'TEXT') as string) ?? '',
          description: (formatToRawValue(description, 'RICH_TEXT') as string) ?? '',
          color: (formatToRawValue(color, 'TEXT') as string) ?? '#4F46E5',
          accessType,
        })
      } else {
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
    } else {
      // Reset flag when dialog closes
      isInitialized.current = false
    }
  }, [open, isEditing, recordId, editableFields, getValue, form, setInitial])

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
  const handleSubmit = (data: InboxFormData) => {
    if (!isValid) return

    const visibility: InboxVisibility = data.accessType === 'anyone' ? 'org_members' : 'custom'

    if (isEditing && inboxId) {
      updateInbox.mutate({
        inboxId,
        data: {
          name: data.name.trim(),
          description: data.description,
          color: data.color,
          visibility,
        },
      })
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

                {/* Access fields */}
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
