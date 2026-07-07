// apps/web/src/components/inbox/inbox-form.tsx
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { Lens, LensChoice } from '@auxx/lib/permissions/visibility/client'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Field, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import { Form } from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { Lock, Trash2, UsersIcon } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { AccessLevelsGuide } from '~/components/mail-permissions/ui/access-levels-guide'
import {
  MailPermissionsUpgradeDialog,
  useMailPermissionsGated,
} from '~/components/mail-permissions/ui/enterprise-gate'
import { GranteeList } from '~/components/mail-permissions/ui/grantee-list'
import { LensSelect } from '~/components/mail-permissions/ui/lens-select'
import { useSaveSystemValues, useSystemValues } from '~/components/resources/hooks'
import { FormColorTagPicker } from '~/components/tags/ui/color-tag-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'

/** A grantee row as the form edits it. */
interface FormGrant {
  actorId: ActorId
  choice: LensChoice
}

/** Form data for inbox form */
interface InboxFormData {
  name: string
  description: string
  color: string
  accessType: 'anyone' | 'restricted'
  /** The org-wide floor when accessType is 'anyone'. Restricted ⇒ floor `none`. */
  floorLens: Exclude<Lens, 'none'>
  grants: FormGrant[]
}

/** Props for the shell-free inbox form core. */
export interface InboxFormProps {
  /** Whether the form is "open" — drives the init/reset cycle. In a dialog this is
   *  the dialog's open state; in the palette it's `page === 'create-inbox'`. */
  open: boolean
  /** RecordId for edit mode, null/undefined for create mode */
  recordId?: RecordId | null
  /** Called after successful save */
  onSuccess?: (inbox: { id: string; name: string; recordId: RecordId }) => void
  /** Dismiss after a successful save / unrecoverable state (dialog closes; palette
   *  closes). */
  onClose: () => void
  /** Cancel/back dismiss. Defaults to {@link onClose}; the palette routes it back
   *  to the root action list instead of closing outright. */
  onCancel?: () => void
  /** Host-specific header. Dialogs render a `DialogHeader`; the palette omits it
   *  (the breadcrumb supplies the title). */
  header?: (ctx: { title: string }) => ReactNode
}

/** Map a stored ResourceAccess row to the form's grant shape. */
function rowToGrant(row: {
  granteeType: string
  granteeId: string
  permission: string
  lens: string | null
}): FormGrant {
  return {
    actorId: toActorId(row.granteeType === 'group' ? 'group' : 'user', row.granteeId),
    choice:
      row.permission === ResourcePermission.admin
        ? 'manager'
        : row.permission === ResourcePermission.edit
          ? 'full'
          : ((row.lens ?? 'full') as LensChoice),
  }
}

/** Stable serialization of grants for dirty comparison. */
function grantsKey(grants: FormGrant[]): string {
  return grants
    .map((g) => `${g.actorId}=${g.choice}`)
    .sort()
    .join(',')
}

/**
 * Shell-free inbox create/edit form: all hooks/state/mutations, the Access
 * section (Everyone/Restricted cards + org-wide level + grantee list, per the
 * mail-permissions UI plan), the color picker, the unsaved-changes guard, and
 * the delete affordance. The only host seams are the `header` slot and
 * `onClose`/`onCancel`. `inbox-dialog.tsx` wraps this in a `Dialog`; the
 * command palette hosts it as a page.
 */
export function InboxForm({
  open,
  recordId,
  onSuccess,
  onClose,
  onCancel,
  header,
}: InboxFormProps) {
  const cancel = onCancel ?? onClose

  // Determine if editing based on prop
  const isEditing = !!recordId

  // Extract inboxId from recordId for mutations
  const inboxId = recordId ? parseRecordId(recordId).entityInstanceId : null

  const { isAdminOrOwner } = useUser()
  const gated = useMailPermissionsGated()
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  // Fetch system field values for edit mode
  const { values: fieldValues, isLoading: isLoadingValues } = useSystemValues(
    recordId,
    ['inbox_name', 'inbox_description', 'inbox_color', 'inbox_default_lens'],
    { autoFetch: true, enabled: isEditing && !!recordId }
  )

  // Existing instance grants (edit mode) — hydrated into the form, saved
  // atomically on submit via the replace-all setInstance mutations.
  const { data: accessRows } = api.resourceAccess.forInstance.useQuery(
    { recordId: recordId ?? '' },
    { enabled: isEditing && !!recordId }
  )

  // Managers (inbox `admin` grantees) may manage access without being org
  // admins (delegation). Everyone else sees the form without the Access section.
  const { data: myAccess } = api.resourceAccess.check.useQuery(
    { recordId: recordId ?? '' },
    { enabled: isEditing && !!recordId && !isAdminOrOwner }
  )
  const canManageAccess =
    !isEditing || isAdminOrOwner || myAccess?.permission === ResourcePermission.admin

  // Save system values with optimistic updates
  const { save: saveSystemValues, isPending: isSavingValues } = useSaveSystemValues(recordId)

  // Track if form has been initialized this open cycle
  const isInitialized = useRef(false)
  // The floor as loaded — `inbox_default_lens` is only written when it changed
  // (writing it requires manage rights + the enterprise gate below `full`).
  const initialLensRef = useRef<Lens | null>(null)
  const initialGrantsRef = useRef<string>('')

  // Form setup
  const form = useForm<InboxFormData>({
    defaultValues: {
      name: '',
      description: '',
      color: 'indigo',
      accessType: 'anyone',
      floorLens: 'full',
      grants: [],
    },
  })

  // Watch form values
  const colorValue = form.watch('color')
  const accessType = form.watch('accessType')
  const floorLens = form.watch('floorLens')
  const grants = form.watch('grants')

  // Combined form values for dirty checking
  // biome-ignore lint/correctness/useExhaustiveDependencies: form.watch values are intentionally used as dependencies for dirty checking
  const formValues = useMemo(
    () => ({
      name: form.watch('name'),
      description: form.watch('description'),
      color: colorValue,
      accessType,
      floorLens,
      grants: grantsKey(grants ?? []),
    }),
    [form.watch('name'), form.watch('description'), colorValue, accessType, floorLens, grants]
  )

  // Track dirty state for unsaved changes warning
  const { isDirty, setInitial } = useDirtyCheck(formValues)

  // Guard against accidental close when dirty. The palette hosts this form without
  // a Dialog, so the guard owns the form's own cancel/close path: the Cancel button
  // routes through `guardedClose`, which (after confirming a discard) calls `cancel`.
  const { guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: cancel,
  })

  // Initialize form when dialog opens (only once per cycle)
  useEffect(() => {
    if (open) {
      // Skip if already initialized
      if (isInitialized.current) return

      if (isEditing && recordId) {
        // In edit mode, wait for values + grants to load (inbox_name is required)
        if (isLoadingValues || fieldValues.inbox_name === undefined) return
        if (accessRows === undefined) return

        isInitialized.current = true

        const name = (fieldValues.inbox_name as string) ?? ''
        const description = (fieldValues.inbox_description as string) ?? ''
        const color = (fieldValues.inbox_color as string) ?? 'indigo'
        const storedLens = (fieldValues.inbox_default_lens as Lens | undefined) ?? 'full'
        const accessType = storedLens === 'none' ? 'restricted' : 'anyone'
        const floorLens = storedLens === 'none' ? 'full' : storedLens
        const grants = accessRows.map(rowToGrant)

        initialLensRef.current = storedLens
        initialGrantsRef.current = grantsKey(grants)

        form.reset({ name, description, color, accessType, floorLens, grants })
        setInitial({
          name,
          description,
          color,
          accessType,
          floorLens,
          grants: grantsKey(grants),
        })
      } else {
        // Create mode: reset to defaults
        isInitialized.current = true
        initialLensRef.current = null
        initialGrantsRef.current = ''

        form.reset({
          name: '',
          description: '',
          color: 'indigo',
          accessType: 'anyone',
          floorLens: 'full',
          grants: [],
        })
        setInitial({
          name: '',
          description: '',
          color: 'indigo',
          accessType: 'anyone',
          floorLens: 'full',
          grants: '',
        })
      }
    } else {
      // Reset flag when dialog closes
      isInitialized.current = false
    }
  }, [open, isEditing, recordId, fieldValues, isLoadingValues, accessRows, form, setInitial])

  // Get tRPC utils for cache invalidation
  const utils = api.useUtils()

  // Confirmation dialog for delete
  const [confirm, ConfirmDeleteDialog] = useConfirm()

  /** Invalidate inbox query caches + the viewer's lens map + grant rows. */
  const invalidateInboxes = () => {
    utils.inbox.getAll.invalidate()
    utils.inbox.myLenses.invalidate()
    utils.record.listAll.invalidate({ entityDefinitionId: 'inbox' })
    if (recordId) utils.resourceAccess.forInstance.invalidate({ recordId })
  }

  // Create inbox mutation
  const createInbox = api.inbox.create.useMutation({
    onError: (error) => {
      toastError({ title: 'Error creating inbox', description: error.message })
    },
  })

  // Grant mutations — additive on create, replace-all on edit.
  const grantInstance = api.resourceAccess.grantInstance.useMutation({
    onError: (error) => {
      toastError({ title: 'Error saving access', description: error.message })
    },
  })
  const setInstance = api.resourceAccess.setInstance.useMutation({
    onError: (error) => {
      toastError({ title: 'Error saving access', description: error.message })
    },
  })

  // Delete inbox mutation
  const deleteInbox = api.inbox.delete.useMutation({
    onSuccess: () => {
      invalidateInboxes()
      onClose()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting inbox', description: error.message })
    },
  })

  const isPending =
    createInbox.isPending ||
    isSavingValues ||
    deleteInbox.isPending ||
    grantInstance.isPending ||
    setInstance.isPending

  // Form validation
  const isValid = (form.watch('name') ?? '').trim().length > 0

  // Handle color change from the color picker
  const handleColorChange = (color: string) => {
    form.setValue('color', color)
  }

  const handleAccessTypeChange = (value: string) => {
    // Restricted means floor `none` — enterprise-gated like every sub-full floor.
    if (value === 'restricted' && gated && initialLensRef.current !== 'none') {
      setUpgradeOpen(true)
      return
    }
    form.setValue('accessType', value as 'anyone' | 'restricted')
  }

  const updateGrant = (actorId: ActorId, choice: LensChoice) => {
    const current = form.getValues('grants') ?? []
    const rest = current.filter((g) => g.actorId !== actorId)
    form.setValue('grants', [...rest, { actorId, choice }])
  }

  const removeGrant = (actorId: ActorId) => {
    const current = form.getValues('grants') ?? []
    form.setValue(
      'grants',
      current.filter((g) => g.actorId !== actorId)
    )
  }

  /** The setInstance payload for one grantee type. */
  const grantsPayload = (allGrants: FormGrant[], type: 'user' | 'group') =>
    allGrants
      .filter((g) => parseActorId(g.actorId).type === type)
      .map((g) => ({
        granteeId: parseActorId(g.actorId).id,
        permission: g.choice === 'manager' ? ResourcePermission.admin : ResourcePermission.view,
        lens: g.choice === 'manager' ? undefined : g.choice,
      }))

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

    const targetLens: Lens = data.accessType === 'anyone' ? data.floorLens : 'none'

    if (isEditing && recordId) {
      const values: Record<string, unknown> = {
        inbox_name: data.name.trim(),
        inbox_description: data.description,
        inbox_color: data.color,
      }
      // Only write the floor when it changed — the write is guarded server-side
      // (managers only; sub-full floors are enterprise).
      if (targetLens !== initialLensRef.current) values.inbox_default_lens = targetLens

      const success = await saveSystemValues(values)
      if (!success) return

      if (canManageAccess && grantsKey(data.grants) !== initialGrantsRef.current) {
        try {
          await setInstance.mutateAsync({
            recordId,
            granteeType: ResourceGranteeType.user,
            grants: grantsPayload(data.grants, 'user'),
          })
          await setInstance.mutateAsync({
            recordId,
            granteeType: ResourceGranteeType.group,
            grants: grantsPayload(data.grants, 'group'),
          })
        } catch {
          return // toast shown by the mutation; keep the form open
        }
      }

      // Field-value mutations don't invalidate inbox query caches, so picker
      // rows and badges stay stale until the React Query staleTime expires.
      // Flush both here so every caller gets fresh data.
      invalidateInboxes()
      onClose()
      onSuccess?.({ id: inboxId!, name: data.name, recordId })
    } else {
      try {
        const created = await createInbox.mutateAsync({
          name: data.name.trim(),
          description: data.description,
          color: data.color,
          status: 'ACTIVE',
          defaultLens: targetLens,
        })
        // Additive grants — the server already added the creator's Manager row.
        const createdRecordId = toRecordId('inbox', created.id)
        for (const grant of data.grants) {
          const { type, id } = parseActorId(grant.actorId)
          await grantInstance.mutateAsync({
            recordId: createdRecordId,
            granteeType: type === 'group' ? ResourceGranteeType.group : ResourceGranteeType.user,
            granteeId: id,
            permission:
              grant.choice === 'manager' ? ResourcePermission.admin : ResourcePermission.view,
            lens: grant.choice === 'manager' ? undefined : grant.choice,
          })
        }
        invalidateInboxes()
        onClose()
        onSuccess?.({ id: created.id, name: created.name, recordId: createdRecordId })
      } catch {
        // toasts shown by the mutations; keep the form open
      }
    }
  }

  const title = isEditing ? 'Edit Inbox' : 'Create Inbox'

  return (
    <>
      {header?.({ title })}

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

            {/* Access section — org admins and inbox Managers only */}
            {canManageAccess && (
              <>
                <Field>
                  <FieldLabel>Access</FieldLabel>
                  <RadioGroup
                    value={accessType}
                    onValueChange={handleAccessTypeChange}
                    className='grid gap-2 sm:grid-cols-2'>
                    <RadioGroupItemCard
                      value='anyone'
                      label='Everyone'
                      icon={<UsersIcon />}
                      description='Everyone in the organization, at a chosen level'
                    />
                    <RadioGroupItemCard
                      value='restricted'
                      label='Restricted'
                      icon={<Lock />}
                      description='Only people and groups you add below'
                    />
                  </RadioGroup>
                </Field>

                {accessType === 'anyone' && (
                  <Field>
                    <FieldLabel>Everyone can see</FieldLabel>
                    <LensSelect
                      value={floorLens}
                      onChange={(choice) =>
                        choice !== 'manager' && form.setValue('floorLens', choice)
                      }
                      size='default'
                      className='w-full'
                    />
                  </Field>
                )}

                <Field>
                  <FieldLabel>People &amp; groups</FieldLabel>
                  <GranteeList
                    grants={grants ?? []}
                    onGrant={updateGrant}
                    onChangeLens={updateGrant}
                    onRevoke={removeGrant}
                    includeManager
                    disabled={isPending}
                    emptyHint={
                      accessType === 'restricted'
                        ? 'No one has access yet. Add people or groups.'
                        : 'No individual access — everyone uses the level above.'
                    }
                  />
                  <button
                    type='button'
                    className='mt-1 self-start text-muted-foreground text-xs underline-offset-2 hover:underline'
                    onClick={() => setGuideOpen(true)}>
                    Learn about access levels
                  </button>
                </Field>
              </>
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

      <ConfirmDialog />
      <ConfirmDeleteDialog />
      <MailPermissionsUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <AccessLevelsGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  )
}
