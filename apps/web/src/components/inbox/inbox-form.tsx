// apps/web/src/components/inbox/inbox-form.tsx
'use client'

import { FieldType, ResourceGranteeType, type SharingGranteeType } from '@auxx/database/enums'
import { type Lens, type LensChoice, normalizeLens } from '@auxx/lib/permissions/visibility/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { type ActorId, toActorId } from '@auxx/types/actor'
import { SELECT_OPTION_COLORS, type SelectOptionColor } from '@auxx/types/custom-field'
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
  GranularPermissionsUpgradeDialog,
  useGranularPermissionsGated,
} from '~/components/mail-permissions/ui/granular-permissions-gate'
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
import {
  type InboxItem,
  invalidateInboxRecordLists,
  toInboxAccessRecordId,
  useInbox,
} from '~/components/threads/hooks/use-inbox'
import { BaseType } from '~/components/workflow/types'
import { useConfirm } from '~/hooks/use-confirm'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { InboxMembersPage } from './inbox-members-page'
import { InboxNameField } from './ui/inbox-name-field'

/** A grantee row as the form edits it. */
interface FormGrant {
  actorId: ActorId
  choice: LensChoice
}

/** Form data for inbox form */
interface InboxFormValues {
  name: string
  description: string
  color: SelectOptionColor
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
  floorLens: 'read',
  grants: [],
}

/**
 * Hoisted so the reference is stable across renders — an inline literal makes
 * `useSystemValues` rebuild its field refs every render and refetch.
 *
 * `inbox_default_lens` is deliberately absent: see the fetch site below.
 */
const INBOX_SYSTEM_ATTRS = ['inbox_name', 'inbox_description', 'inbox_color'] as const

/**
 * Narrows a stored `inbox_color` field value to a known swatch. Rows written
 * before the palette settled (or by an import) can hold anything, and the
 * picker only renders the known ids — fall back to the create-mode default.
 */
function toSelectOptionColor(value: unknown): SelectOptionColor {
  return SELECT_OPTION_COLORS.includes(value as SelectOptionColor)
    ? (value as SelectOptionColor)
    : DEFAULT_VALUES.color
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
  /** Called after a successful deletion. */
  onDeleted?: () => void
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
  /** Scoped metadata supplied by the settings list to avoid loading every inbox. */
  inboxSummary?: Pick<InboxItem, 'id' | 'entityDefinitionKey' | 'isPersonal' | 'ownerUserId'>
  /** Whether the generic shared-inbox delete action is available. */
  canDelete?: boolean
}

/**
 * The grantee types this form's PEOPLE & GROUPS list owns. The save path is
 * replace-per-type (`setInstance` swaps one `granteeType` at a time), so a kind
 * absent from this list is left untouched on save rather than wiped — which is
 * exactly why the list must stay in lockstep with what the grantee list can
 * render and edit.
 *
 * **`role` is excluded on purpose, and the reason changed with plan 40 §6.** It
 * used to be excluded because the org-wide floor was not a row at all (it was
 * the `inbox_default_lens` FieldValue). The floor IS a row now —
 * `role:org_member` — but it is edited by the Everyone/Restricted cards above,
 * not by the grantee list, and it must NOT be in the replace-all set: a save
 * that touched no people would otherwise wipe the inbox's floor and silently
 * reopen a Restricted inbox to the whole org. `profile` (plan 19 §8.2) stays
 * excluded as before and is disclosed via {@link unmanageableGrantsNote}.
 */
const MANAGED_GRANTEE_TYPES: readonly SharingGranteeType[] = [
  ResourceGranteeType.user,
  ResourceGranteeType.group,
]

/**
 * The org-wide floor an inbox's grant rows encode (plan 40 §6) — the read half
 * of what `inbox.setAccessFloor` writes.
 *
 * `role:org_member @ none` is the v2 RESTRICTION marker (never a grant);
 * `@ view` carries the tier as its `lens`; **no row at all means `full`**, the
 * org-shared default supplied by the `Area.inboxes` fallback. Read off the
 * `resourceAccess.forInstance` rows the form already fetches, so the conversion
 * costs no extra query.
 */
function floorFromRows(
  rows: ReadonlyArray<{
    granteeType: string
    granteeId: string
    rung: string
  }>
): Lens {
  const baseline = rows.find(
    (r) => r.granteeType === ResourceGranteeType.role && r.granteeId === 'org_member'
  )
  // No baseline row IS the org-shared default (plan 40 §6). `edit`/`admin` are
  // dead vocabulary on an inbox baseline; both clamp to `read`, matching
  // `floorFromBaselineRow` server-side.
  if (!baseline) return 'read'
  return normalizeLens(baseline.rung, 'read')
}

/**
 * Map a stored ResourceAccess row to the form's grant shape, or `null` when the
 * grantee kind has no ActorId representation. Never coerces an unknown kind to
 * `user` — that produced a row keyed on the wrong table's id.
 */
function rowToGrant(row: {
  granteeType: string
  granteeId: string
  rung: string
}): FormGrant | null {
  const actorId = granteeToActorId(row.granteeType, row.granteeId)
  if (!actorId) return null
  return {
    actorId,
    // `admin` on an inbox IS the Manager entry; `edit` is dead vocabulary here
    // and reads as full mail access, which `normalizeLens`'s fallback supplies.
    choice: row.rung === 'admin' ? 'manager' : (normalizeLens(row.rung, 'read') as LensChoice),
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
  onDeleted,
  onClose,
  onCancel,
  enableMembersPage = false,
  header,
  inboxSummary,
  canDelete = false,
}: InboxFormProps) {
  const cancel = onCancel ?? onClose

  // Which page is showing — the `members` drill exists only when enabled.
  const [page, setPage] = useState<'main' | 'members'>('main')

  // Determine if editing based on prop
  const isEditing = !!recordId

  // Extract inboxId from recordId for mutations
  const inboxId = recordId ? parseRecordId(recordId).entityInstanceId : null

  const { canAdminInstance } = useAccess()
  const gated = useGranularPermissionsGated()
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  // Personal-account inbox (§11): the Access section swaps the floor controls
  // for an owner row + activity-only note; the owner's Manager row is locked.
  const { inbox: inboxItem } = useInbox(recordId ?? undefined, {
    enabled: isEditing && !inboxSummary,
  })
  const isPersonalInbox = inboxSummary?.isPersonal ?? !!inboxItem?.isPersonal
  const ownerUserId = inboxSummary?.ownerUserId ?? inboxItem?.ownerUserId
  const ownerActorId = ownerUserId ? toActorId('user', ownerUserId) : null
  const accessInbox = inboxSummary ?? inboxItem

  // Fetch system field values for edit mode.
  //
  // `inbox_default_lens` is deliberately NOT among them (plan 40 §6): the floor
  // moved onto the `role:org_member` `ResourceAccess` row, so it is read out of
  // `accessRows` below. Reading the field would render the floor the inbox had
  // before its last edit.
  const { values: fieldValues, isLoading: isLoadingValues } = useSystemValues(
    recordId,
    INBOX_SYSTEM_ATTRS,
    { autoFetch: true, enabled: isEditing && !!recordId }
  )

  // Existing instance grants (edit mode) — hydrated into the form, saved
  // atomically on submit via the replace-all setInstance mutations.
  const { data: accessRows } = api.resourceAccess.forInstance.useQuery(
    { recordId: recordId ?? '' },
    { enabled: isEditing && !!recordId }
  )

  // Managers may manage access without an org-role shortcut. This is especially
  // important for personal inboxes, where rank alone never opens the mailbox.
  const canManageAccess =
    !isEditing || (!!accessInbox && canAdminInstance(toInboxAccessRecordId(accessInbox)))

  // Save system values with optimistic updates
  const { save: saveSystemValues, isPending: isSavingValues } = useSaveSystemValues(recordId)

  // Track if form has been initialized this open cycle
  const isInitialized = useRef(false)
  // The floor as loaded — the baseline row is only rewritten when it changed
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
        const color = toSelectOptionColor(fieldValues.inbox_color)
        // The floor comes from the `role:org_member` baseline ROW, not from a
        // field value (plan 40 §6) — same rows the grantee list is built from.
        const storedLens = floorFromRows(accessRows)
        const accessType: InboxFormValues['accessType'] =
          storedLens === 'none' ? 'restricted' : 'anyone'
        const floorLens = (storedLens === 'none' ? 'read' : storedLens) as Exclude<Lens, 'none'>
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
    utils.inbox.myLenses.invalidate()
    utils.inbox.settingsList.invalidate()
    invalidateInboxRecordLists(utils)
    if (recordId) utils.resourceAccess.forInstance.invalidate({ recordId })
  }

  // Create inbox mutation
  const createInbox = api.inbox.create.useMutation({
    onError: (error) => {
      toastError({ title: 'Error creating inbox', description: error.message })
    },
  })

  /**
   * The org-wide floor write (plan 40 §6) — a `role:org_member` baseline row,
   * NOT the `inbox_default_lens` field the form used to save. Its own procedure
   * rather than `resourceAccess.grantInstance` because the Restricted floor is
   * `permission: 'none'` with a null lens, which slips past
   * `assertMailSharingFeature`'s sub-`read` rung test — `inbox.setAccessFloor`
   * carries the `granularPermissions` plan gate the retired field wall used to.
   */
  const setAccessFloor = api.inbox.setAccessFloor.useMutation({
    onError: (error) => {
      toastError({ title: 'Error saving access', description: error.message })
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
      // Deleting a PERSONAL inbox disconnects its account and destroys its
      // mail, so the channel inventory and the sidebar counters move with it.
      utils.channel.list.invalidate()
      utils.thread.getCounts.invalidate()
      onClose()
      onDeleted?.()
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
    setInstance.isPending ||
    setAccessFloor.isPending

  // Form validation
  const isValid = values.name.trim().length > 0

  const handleAccessTypeChange = (value: string) => {
    // Restricted means floor `none` — plan-gated like every sub-full floor.
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
          rung: g.choice === 'manager' ? ('admin' as const) : g.choice,
        },
      ]
    })

  // Handle delete with confirmation
  const handleDelete = async () => {
    if (!inboxId) return

    // A personal mailbox is a one-account container, so deleting it also
    // disconnects that account and destroys its mail — say so before the click.
    const confirmed = await confirm({
      title: isPersonalInbox ? 'Delete personal inbox?' : 'Delete inbox?',
      description: isPersonalInbox
        ? 'This disconnects the connected account and permanently deletes this inbox with all of its mail. This action cannot be undone.'
        : 'This will permanently delete this inbox and all its settings. This action cannot be undone.',
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

      const success = await saveSystemValues(systemValues)
      if (!success) return

      // Only write the floor when it changed — the write is guarded server-side
      // (managers only; sub-full floors are enterprise). This is a
      // `role:org_member` `ResourceAccess` row, not a field: writing
      // `inbox_default_lens` here made every access-level change a no-op, since
      // nothing has read that field since plan 40 phase 2.
      if (canManageAccess && !isPersonalInbox && targetLens !== initialLensRef.current && inboxId) {
        try {
          await setAccessFloor.mutateAsync({ inboxId, floorLens: targetLens })
        } catch {
          return // toast shown by the mutation; keep the form open
        }
      }

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
          // Still a `defaultLens` INPUT, but `InboxService.createInbox` now
          // lands it as the `role:org_member` baseline row rather than the
          // `inbox_default_lens` field — and `full` writes no row at all, since
          // the absent baseline IS the org-shared default (plan 40 §6).
          defaultLens: targetLens,
        })
        // Additive grants — the server already added the creator's Manager row.
        //
        // Take the RecordId the server MINTED rather than re-deriving it: it
        // carries the definition the instance actually landed on (plan 40 §3 /
        // 40a §5.1). `inbox.create` is shared-only by contract — personal
        // mailboxes come from the provisioning path alone — so this is
        // `inbox:<id>` today, but a hard-coded prefix here is exactly the shape
        // that silently mis-keys grant rows if that ever stops being true.
        const createdRecordId = created.recordId
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
            rung: grant.choice === 'manager' ? ('admin' as const) : grant.choice,
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
  // `data-dialog-submit` button. When the members drill is on, the BODY pads itself
  // inside the flush `p-0` DialogNav shell — the padding must stay off the `<form>`
  // so the footer remains an unpadded sibling of the body, which is what
  // `DialogNavPages` re-gutters via its `[data-slot=dialog-footer]` rule. Padding the
  // form instead stacks both gutters and indents the buttons past the fields.
  // The palette host pads the whole page instead and turns that rule off
  // (`footerGutter={false}`), so this form stays unpadded in both hosts.
  const configurePage = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void handleSubmit()
      }}
      className='flex flex-col'>
      {/* `pt-4` not `p-4` on the bottom edge: the footer supplies its own `pt-4`,
          so padding the body bottom too would double the gap above the buttons. */}
      <div className={enableMembersPage ? 'flex flex-col gap-4 px-4 pt-4' : 'flex flex-col gap-4'}>
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
            <InboxNameField
              name={values.name}
              onNameChange={(val) => handleChange('name', val)}
              color={values.color}
              onColorChange={(color) => handleChange('color', color)}
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
                    Personal account: mail here is private to its owner. Admins can see activity
                    only; assignment and shares grant access per thread.
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
      </div>

      <DialogFooter className='flex sm:justify-between!'>
        {isEditing && canDelete ? (
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
      <GranularPermissionsUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <AccessLevelsGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  )
}
