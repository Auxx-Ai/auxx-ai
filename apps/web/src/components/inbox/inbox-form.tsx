// apps/web/src/components/inbox/inbox-form.tsx
'use client'

import {
  FieldType,
  ResourceGranteeType,
  ResourcePermission,
  type SharingGranteeType,
} from '@auxx/database/enums'
import type { Lens, LensChoice } from '@auxx/lib/permissions/visibility/client'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { type ActorId, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { toastError } from '@auxx/ui/components/toast'
import { ChevronRight, Eye, Lock, Shield, Trash2, UsersIcon } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { AccessLevelsGuide } from '~/components/mail-permissions/ui/access-levels-guide'
import {
  MailPermissionsUpgradeDialog,
  useMailPermissionsGated,
} from '~/components/mail-permissions/ui/enterprise-gate'
import { LensSelect } from '~/components/mail-permissions/ui/lens-select'
import { MailGranteeList } from '~/components/mail-permissions/ui/mail-grantee-list'
import {
  actorIdToGrantee,
  GRANTEE_UNSUPPORTED_MESSAGE,
  granteeToActorId,
  isActorGrantee,
  type ShareGrantee,
  type UnmanageableGrant,
} from '~/components/permissions/utils/grantee'
import { useSaveSystemValues, useSystemValues } from '~/components/resources/hooks'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { FormColorTagPicker } from '~/components/tags/ui/color-tag-picker'
import { useInbox } from '~/components/threads/hooks/use-inbox'
import { BaseType } from '~/components/workflow/types'
import { useConfirm } from '~/hooks/use-confirm'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { InboxMembersPage } from './inbox-members-page'

/** A grantee row as the form edits it. */
interface FormGrant {
  actorId: ActorId
  choice: LensChoice
}

/** Form data for inbox form */
interface InboxFormValues {
  name: string
  description: string
  color: string
  accessType: 'anyone' | 'restricted'
  /** The org-wide floor when accessType is 'anyone'. Restricted ⇒ floor `none`. */
  floorLens: Exclude<Lens, 'none'>
  grants: FormGrant[]
}

const DEFAULT_VALUES: InboxFormValues = {
  name: '',
  description: '',
  color: 'indigo',
  accessType: 'anyone',
  floorLens: 'full',
  grants: [],
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
  /**
   * Drill "People & groups" into a second page (webhook-dialog style) instead of
   * rendering the grantee list inline. Enabled by the dialog host (which has the
   * `DialogNav` shell); the palette leaves it off and keeps the inline list.
   */
  enableMembersPage?: boolean
  /** Host-specific header. Dialogs render a `DialogNav` (with a Back button on the
   *  members page); the palette omits it (the breadcrumb supplies the title). */
  header?: (ctx: { title: string; page: 'main' | 'members'; onBack: () => void }) => ReactNode
}

/**
 * The grantee types this form OWNS. The save path is replace-per-type
 * (`setInstance` swaps one `granteeType` at a time), so a kind absent from this
 * list is left untouched on save rather than wiped — which is exactly why the
 * list must stay in lockstep with what the grantee list can render and edit.
 * Kinds outside it (`role` — the org-wide floor, expressed as
 * `inbox_default_lens`; `profile` — plan 19 §8.2) are disclosed to the admin via
 * {@link unmanageableGrantsNote} instead of being silently dropped.
 */
const MANAGED_GRANTEE_TYPES: readonly SharingGranteeType[] = [
  ResourceGranteeType.user,
  ResourceGranteeType.group,
]

/**
 * Map a stored ResourceAccess row to the form's grant shape, or `null` when the
 * grantee kind has no ActorId representation. Never coerces an unknown kind to
 * `user` — that produced a row keyed on the wrong table's id.
 */
function rowToGrant(row: {
  granteeType: string
  granteeId: string
  permission: string
  lens: string | null
}): FormGrant | null {
  const actorId = granteeToActorId(row.granteeType, row.granteeId)
  if (!actorId) return null
  return {
    actorId,
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
 * the delete affordance. The layout uses the shared `FieldPanel`/`FieldPanelRow`
 * primitives (label column left, input right). The only host seams are the
 * `header` slot and `onClose`/`onCancel`. `inbox-dialog.tsx` wraps this in a
 * `Dialog`; the command palette hosts it as a page.
 */
export function InboxForm({
  open,
  recordId,
  onSuccess,
  onClose,
  onCancel,
  enableMembersPage = false,
  header,
}: InboxFormProps) {
  const cancel = onCancel ?? onClose

  // Which page is showing — the `members` drill exists only when enabled.
  const [page, setPage] = useState<'main' | 'members'>('main')

  // Determine if editing based on prop
  const isEditing = !!recordId

  // Extract inboxId from recordId for mutations
  const inboxId = recordId ? parseRecordId(recordId).entityInstanceId : null

  const { isAdminOrOwner } = useUser()
  const gated = useMailPermissionsGated()
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  // Personal-account inbox (§11): the Access section swaps the floor controls
  // for an owner row + activity-only note; the owner's Manager row is locked.
  const { inbox: inboxItem } = useInbox(recordId ?? undefined)
  const isPersonalInbox = !!inboxItem?.isPersonal
  const ownerActorId = inboxItem?.ownerUserId ? toActorId('user', inboxItem.ownerUserId) : null

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

  // Plain value bag + per-field errors (part-form-dialog pattern).
  const [values, setValues] = useState<InboxFormValues>(DEFAULT_VALUES)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = <K extends keyof InboxFormValues>(field: K, value: InboxFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      if (prev[field as string]) {
        const next = { ...prev }
        delete next[field as string]
        return next
      }
      return prev
    })
  }

  /**
   * Rows the grantee list can't render or edit — a `profile` grant today (plan
   * 19 §8.2). `setInstance` replaces one `granteeType` at a time, so these rows
   * SURVIVE this form's save; disclosing them keeps the "N people & groups"
   * summary from reading as the complete picture.
   */
  const unmanageableGrants = useMemo<UnmanageableGrant[]>(
    () =>
      (accessRows ?? [])
        .filter((r) => !isActorGrantee(r.granteeType) && r.granteeType !== ResourceGranteeType.role)
        .map((r) => ({ granteeType: r.granteeType, granteeId: r.granteeId })),
    [accessRows]
  )

  // Combined snapshot for dirty checking (grants serialized for stability).
  const formSnapshot = useMemo(
    () => ({
      name: values.name,
      description: values.description,
      color: values.color,
      accessType: values.accessType,
      floorLens: values.floorLens,
      grants: grantsKey(values.grants),
    }),
    [values]
  )

  // Track dirty state for unsaved changes warning
  const { isDirty, setInitial } = useDirtyCheck(formSnapshot)

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
        // useSystemValues now collapses SINGLE_SELECT to a scalar, so this is a
        // plain lens string (was an array — the source of the round-trip bug).
        const storedLens = (fieldValues.inbox_default_lens as Lens | undefined) ?? 'full'
        const accessType = storedLens === 'none' ? 'restricted' : 'anyone'
        const floorLens = (storedLens === 'none' ? 'full' : storedLens) as Exclude<Lens, 'none'>
        const grants = accessRows.flatMap((row) => rowToGrant(row) ?? [])

        initialLensRef.current = storedLens
        initialGrantsRef.current = grantsKey(grants)

        const next = { name, description, color, accessType, floorLens, grants }
        setValues(next)
        setInitial({ ...next, grants: grantsKey(grants) })
      } else {
        // Create mode: reset to defaults
        isInitialized.current = true
        initialLensRef.current = null
        initialGrantsRef.current = ''

        setValues(DEFAULT_VALUES)
        setInitial({ ...DEFAULT_VALUES, grants: '' })
      }
    } else {
      // Reset flag when dialog closes
      isInitialized.current = false
    }
  }, [open, isEditing, recordId, fieldValues, isLoadingValues, accessRows, setInitial])

  // Always reopen on the main page (never mid-drill from a previous session).
  useEffect(() => {
    if (!open) setPage('main')
  }, [open])

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
  const isValid = values.name.trim().length > 0

  const handleAccessTypeChange = (value: string) => {
    // Restricted means floor `none` — enterprise-gated like every sub-full floor.
    if (value === 'restricted' && gated && initialLensRef.current !== 'none') {
      setUpgradeOpen(true)
      return
    }
    handleChange('accessType', value as 'anyone' | 'restricted')
  }

  const updateGrant = (actorId: ActorId, choice: LensChoice) => {
    const rest = values.grants.filter((g) => g.actorId !== actorId)
    handleChange('grants', [...rest, { actorId, choice }])
  }

  const removeGrant = (actorId: ActorId) => {
    handleChange(
      'grants',
      values.grants.filter((g) => g.actorId !== actorId)
    )
  }

  /**
   * The `setInstance` payload for one grantee type. Resolves each form grant to
   * its storage grantee first, so a row whose ActorId has no grantee
   * representation is dropped from EVERY bucket instead of landing in the `user`
   * one with an id that points at another table.
   */
  const grantsPayload = (allGrants: FormGrant[], type: SharingGranteeType) =>
    allGrants.flatMap((g) => {
      const grantee = actorIdToGrantee(g.actorId)
      if (!grantee || grantee.granteeType !== type) return []
      return [
        {
          granteeId: grantee.granteeId,
          permission: g.choice === 'manager' ? ResourcePermission.admin : ResourcePermission.view,
          lens: g.choice === 'manager' ? undefined : g.choice,
        },
      ]
    })

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
  const handleSubmit = async () => {
    if (!isValid) {
      setErrors({ name: 'Name is required' })
      return
    }

    const targetLens: Lens = values.accessType === 'anyone' ? values.floorLens : 'none'

    if (isEditing && recordId) {
      const systemValues: Record<string, unknown> = {
        inbox_name: values.name.trim(),
        inbox_description: values.description,
        inbox_color: values.color,
      }
      // Only write the floor when it changed — the write is guarded server-side
      // (managers only; sub-full floors are enterprise).
      if (targetLens !== initialLensRef.current) systemValues.inbox_default_lens = targetLens

      const success = await saveSystemValues(systemValues)
      if (!success) return

      if (canManageAccess && grantsKey(values.grants) !== initialGrantsRef.current) {
        try {
          // One replace-all pass per MANAGED type. Unlisted kinds keep their rows.
          for (const granteeType of MANAGED_GRANTEE_TYPES) {
            await setInstance.mutateAsync({
              recordId,
              granteeType,
              grants: grantsPayload(values.grants, granteeType),
            })
          }
        } catch {
          return // toast shown by the mutation; keep the form open
        }
      }

      // Field-value mutations don't invalidate inbox query caches, so picker
      // rows and badges stay stale until the React Query staleTime expires.
      // Flush both here so every caller gets fresh data.
      invalidateInboxes()
      onClose()
      onSuccess?.({ id: inboxId!, name: values.name, recordId })
    } else {
      try {
        const created = await createInbox.mutateAsync({
          name: values.name.trim(),
          description: values.description,
          color: values.color,
          status: 'ACTIVE',
          defaultLens: targetLens,
        })
        // Additive grants — the server already added the creator's Manager row.
        const createdRecordId = toRecordId('inbox', created.id)
        for (const grant of values.grants) {
          const grantee: ShareGrantee | null = actorIdToGrantee(grant.actorId)
          if (!grantee) {
            toastError({
              title: 'Some access was not saved',
              description: GRANTEE_UNSUPPORTED_MESSAGE,
            })
            continue
          }
          await grantInstance.mutateAsync({
            recordId: createdRecordId,
            ...grantee,
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

  const membersEmptyHint = isPersonalInbox
    ? 'Only the owner has access. Add people or groups to share.'
    : values.accessType === 'restricted'
      ? 'No one has access yet. Add people or groups.'
      : 'No individual access — everyone uses the level above.'
  const membersSummary =
    values.grants.length > 0
      ? `${values.grants.length} ${values.grants.length === 1 ? 'person or group' : 'people & groups'}`
      : 'Add people or groups'

  // Page 1 — the configure form (name/color/access). A transparent `<form>` wrapper
  // (not part of the FieldPanel look) keeps native keyboard-submit working in the
  // palette host, which has no Dialog shell to run the Cmd+Enter handler. In the
  // dialog host plain Enter is suppressed by DialogContent and Cmd+Enter clicks the
  // `data-dialog-submit` button. When the members drill is on, the form pads itself
  // inside the flush `p-0` DialogNav shell; the palette host supplies its own padding.
  const configurePage = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void handleSubmit()
      }}
      className={enableMembersPage ? 'flex flex-col gap-4 p-4' : 'flex flex-col gap-4'}>
      <FieldPanel
        orientation='responsive'
        breakpoint='md'
        resizeId='inbox-form'
        defaultLabelWidth={200}
        className='p-0'>
        {/* Name */}
        <FieldPanelRow
          title='Name'
          type={BaseType.STRING}
          showIcon
          isRequired
          validationError={errors.name}
          validationType='error'>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={values.name}
            onChange={(val) => handleChange('name', (val as string) ?? '')}
            placeholder='Enter inbox name'
            disabled={isPending}
          />
        </FieldPanelRow>

        {/* Description */}
        <FieldPanelRow title='Description' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={values.description}
            onChange={(val) => handleChange('description', (val as string) ?? '')}
            placeholder='Optional description'
            disabled={isPending}
            fieldOptions={{ multiline: true }}
          />
        </FieldPanelRow>

        {/* Color */}
        <FieldPanelRow title='Color' type={BaseType.ENUM} showIcon>
          <div className='py-2'>
            <FormColorTagPicker
              value={values.color}
              onChange={(color) => handleChange('color', color)}
            />
          </div>
        </FieldPanelRow>

        {/* Access section — org admins and inbox Managers only */}
        {canManageAccess &&
          (isPersonalInbox ? (
            <FieldPanelRow title='Access' showIcon icon={<Shield />} className='@md:flex-col!'>
              <div className='space-y-2 rounded-[13px] border p-3 mb-1 me-1 -ms-1'>
                {ownerActorId && (
                  <div className='flex items-center justify-between'>
                    <ActorBadge actorId={ownerActorId} />
                    <span className='text-muted-foreground text-xs'>Owner</span>
                  </div>
                )}
                <p className='text-muted-foreground text-xs'>
                  Personal account: mail here is private to its owner. Admins can see activity only;
                  assignment and shares grant access per thread.
                </p>
              </div>
            </FieldPanelRow>
          ) : (
            <>
              <FieldPanelRow title='Access' showIcon icon={<Shield />} className='@md:flex-col!'>
                <RadioGroup
                  value={values.accessType}
                  onValueChange={handleAccessTypeChange}
                  className='grid gap-2 py-2 pe-2 sm:grid-cols-2'>
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
              </FieldPanelRow>

              {values.accessType === 'anyone' && (
                <FieldPanelRow title='Everyone can see' showIcon icon={<Eye />}>
                  <LensSelect
                    value={values.floorLens}
                    onChange={(choice) =>
                      choice !== 'manager' &&
                      handleChange('floorLens', choice as Exclude<Lens, 'none'>)
                    }
                    size='default'
                    variant='transparent'
                    className='w-full'
                  />
                </FieldPanelRow>
              )}
            </>
          ))}
      </FieldPanel>

      {/* People & groups — a standalone section below the panel (like the webhook
          Topics drill), not a FieldPanelRow. */}
      {canManageAccess && (
        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-1.5 px-1 text-muted-foreground text-xs font-medium'>
            <UsersIcon className='size-3.5' />
            People &amp; groups
          </div>
          {enableMembersPage ? (
            // Drill into the members page (webhook-topics style).
            <button
              type='button'
              onClick={() => setPage('members')}
              className='flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50'>
              <span className='flex items-center gap-2 text-muted-foreground'>
                {membersSummary}
              </span>
              <ChevronRight className='size-4 text-muted-foreground' />
            </button>
          ) : (
            <>
              <MailGranteeList
                grants={values.grants}
                onGrant={updateGrant}
                onChangeLens={updateGrant}
                onRevoke={removeGrant}
                includeManager
                disabled={isPending}
                lockedActorIds={isPersonalInbox && ownerActorId ? [ownerActorId] : []}
                unmanageableGrants={unmanageableGrants}
                emptyHint={membersEmptyHint}
              />
              <button
                type='button'
                className='mt-1 self-start text-muted-foreground text-xs underline-offset-2 hover:underline'
                onClick={() => setGuideOpen(true)}>
                Learn about access levels
              </button>
            </>
          )}
        </div>
      )}

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
            disabled={!isValid || isPending}
            data-dialog-submit>
            {isEditing ? 'Update Inbox' : 'Create Inbox'} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </div>
      </DialogFooter>
    </form>
  )

  // Page 2 — the "People & groups" drill (dialog host only).
  const membersPage = (
    <InboxMembersPage
      grants={values.grants}
      onGrant={updateGrant}
      onChangeLens={updateGrant}
      onRevoke={removeGrant}
      includeManager
      disabled={isPending}
      lockedActorIds={isPersonalInbox && ownerActorId ? [ownerActorId] : []}
      unmanageableGrants={unmanageableGrants}
      emptyHint={membersEmptyHint}
      note={
        isPersonalInbox
          ? 'Personal account — mail here is private to its owner. Admins can see activity only; assignment and shares grant access per thread.'
          : undefined
      }
      onOpenGuide={() => setGuideOpen(true)}
      onBack={() => setPage('main')}
    />
  )

  return (
    <>
      {header?.({ title, page, onBack: () => setPage('main') })}

      {enableMembersPage ? (
        <DialogNavPages value={page}>
          <DialogNavPage value='main' size='md'>
            {configurePage}
          </DialogNavPage>
          <DialogNavPage value='members' size='md'>
            {membersPage}
          </DialogNavPage>
        </DialogNavPages>
      ) : (
        configurePage
      )}

      <ConfirmDialog />
      <ConfirmDeleteDialog />
      <MailPermissionsUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <AccessLevelsGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  )
}
