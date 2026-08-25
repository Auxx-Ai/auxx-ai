// apps/web/src/components/custom-fields/ui/entity-instance/entity-instance-form.tsx
'use client'

import type { FieldGroup, ViewContextType } from '@auxx/lib/conditions/client'
import { formatToRawValue } from '@auxx/lib/field-values/client'
import {
  isTrailingMetadataField,
  parseRecordId,
  type RecordId,
  type ResourceField,
  toRecordId,
} from '@auxx/lib/resources/client'
import { Button, buttonVariants } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Pencil, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFieldGroupDnd } from '~/components/fields/hooks/use-field-group-dnd'
import { useFieldView } from '~/components/fields/hooks/use-field-view'
import { useFieldViewDraft } from '~/components/fields/hooks/use-field-view-draft'
import { mergeFieldOrder } from '~/components/fields/merge-field-order'
import { AddGroupRow } from '~/components/fields/rows/field-group-row'
import {
  FieldGroupList,
  type FieldGroupListRowContext,
} from '~/components/fields/ui/field-group-list'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { useResource } from '~/components/resources'
import { useCreateRecord } from '~/components/resources/hooks/use-create-record'
import { useFieldValueSyncer } from '~/components/resources/hooks/use-field-value-syncer'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useConfirm } from '~/hooks/use-confirm'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { useAccess } from '~/providers/capabilities-provider'
import { DialogFieldConfigRow } from '../dialog-field-config-row'
import { FieldInputRow } from '../field-input-row'

/** The view id a field is keyed by in `fieldOrder` / `fieldGroups[].fieldIds`. */
function viewFieldId(field: { resourceFieldId?: unknown; id?: unknown; key?: unknown }): string {
  return String(field.resourceFieldId ?? field.id ?? field.key)
}

/**
 * A grouped row's inset.
 *
 * The label column is a fixed width synced across mounted panels, and the resize
 * divider is ONE absolutely positioned line at that offset — so indenting the
 * ROW would push its content column 12px past the divider and break the
 * alignment contract for grouped rows only. Indent the label TEXT instead,
 * keeping the label/content boundary global. On mobile there is no fixed column
 * to misalign, so the whole row can indent there.
 *
 * The label-slot override beats `FieldPanelRow`'s own `ps-2` on specificity —
 * (0,2,0) vs (0,1,0) — the same mechanism `FieldPanel` uses for its orientation
 * rules. `@md` matches the `breakpoint='md'` both panels below declare.
 */
const GROUPED_ROW_CLASS = 'ps-3 @md:ps-0 @md:[&_[data-slot=field-row-label]]:ps-5'

/**
 * Re-align the group header with the rows around it.
 *
 * `FieldGroupRow` is shaped for the property panel, whose rows put their glyph
 * in a 24px band flush with the row's left edge and band it to the row's TOP.
 * A `FieldPanelRow` does neither: its icon sits in the panel's `ps-2` gutter and
 * is vertically centred. The 24px band width is unchanged either way, so the
 * header's label text stays on the same x as the field names below it — only
 * the glyph and the vertical banding move.
 */
const GROUP_HEADER_CLASS = [
  '[&_[data-slot=field-group-glyph]]:justify-start [&_[data-slot=field-group-glyph]]:ps-2',
  '[&_[data-slot=field-group-band]]:self-center',
  // The rows' content area ends on `pe-2`, so their switches never touch the
  // panel's edge. The header's delete button gets the same gutter.
  '[&_[data-slot=field-group-actions]]:pe-2',
].join(' ')

/** What each mode hands `FieldGroupList` to draw one row. */
type FieldListRowRenderer = (field: ResourceField, ctx: FieldGroupListRowContext) => ReactNode

/** Stable empty array so a group-less view keeps referential identity across renders. */
const NO_GROUPS: FieldGroup[] = []

/** Title + description derived from the form's mode, handed to the header slot. */
export interface EntityInstanceFormHeaderContext {
  title: string
  description: string
}

export interface EntityInstanceFormProps {
  /** Whether the form is "open" — drives the init/reset cycle. In a dialog this
   *  is the dialog's open state; in the palette it's `page === 'create'`. */
  open: boolean
  /** Entity definition ID. */
  entityDefinitionId: string
  /** RecordId for edit mode; omitted for create. */
  recordId?: RecordId
  /** Callback after a successful save. */
  onSaved?: (instanceId: string) => void
  /** Preset field values for CREATE mode (`{ fieldId: value }`). */
  presetValues?: Record<string, unknown>
  /** Direct close — called after a successful save when not creating more. */
  onClose: () => void
  /** Guarded close for Cancel/back. The host shows the discard confirm if dirty. */
  onRequestClose: () => void
  /** Reports dirty state up so a non-dialog host can guard navigation. */
  onDirtyChange?: (isDirty: boolean) => void
  /** Host-rendered header. The dialog supplies a `DialogHeader`; the palette omits
   *  it and relies on the breadcrumb. */
  header?: (ctx: EntityInstanceFormHeaderContext) => ReactNode
  /** Optional create-only content and values supplied by an entity-specific host. */
  createExtension?: {
    content: ReactNode
    values: Record<string, unknown>
    isDirty?: boolean
    onReset?: () => void
  }
}

/**
 * Host-agnostic core of the create/edit entity form: all of the field state,
 * config mode, and both footer variants — everything the old
 * `EntityInstanceDialog` rendered *except* the modal shell and header. A dialog
 * wraps it in `Dialog`/`DialogContent`; the command palette hosts it as a page.
 * The only host seam is the `header` slot plus the `onClose` / `onRequestClose`
 * / `onDirtyChange` callbacks.
 */
export function EntityInstanceForm({
  open,
  entityDefinitionId,
  recordId,
  onSaved,
  presetValues,
  onClose,
  onRequestClose,
  onDirtyChange,
  header,
  createExtension,
}: EntityInstanceFormProps) {
  // Parse recordId to get instance ID for editing
  const editingInstanceId = recordId ? parseRecordId(recordId).entityInstanceId : undefined
  const isEditing = !!editingInstanceId

  // Get resource definition with fields
  const { resource } = useResource(entityDefinitionId)

  // Determine context type based on mode (for normal form rendering)
  const contextType = isEditing ? 'dialog_edit' : 'dialog_create'

  // Config mode edits the ORG'S shared default view for this context — def
  // administration (the `Full`/`admin` rung), not record editing. It is the same
  // capability the server gates the write on (`tableView.update` →
  // `assertStructuralAccess` → `assertAdministerDef`) and the same one the
  // property panel gates its own pencil on, so the affordance and the write
  // agree instead of ending in a 403 toast over a layout the user just built.
  const { canAdministerDef } = useAccess()
  const canConfigureView = canAdministerDef(entityDefinitionId)

  // Get all potentially editable fields first. `resource.fields` already arrives
  // in baseline order — `ORDER BY sortOrder ASC` server-side, then partitioned by
  // `sortFieldsWithMetadataLast` — so no re-sort here; re-sorting by raw
  // `sortOrder` would discard that partition and make this surface define
  // "baseline" differently from the property panel.
  //
  // `creatable` is the pool floor, NOT because this list is create-only — it also
  // feeds edit mode — but because it is the closest proxy for "writable through
  // the generic `fieldValue.set` path this dialog uses". An edit-only system
  // field (`thread_status`, `subject`) has a `dbColumn` on its host table, and
  // that path writes a `FieldValue` row while reads project the column — so the
  // edit would appear to save and silently vanish, on top of skipping the
  // lifecycle events, counters and provider push that `ThreadMutationService`
  // owns. Those fields are updatable via their own routers; they are simply not
  // this dialog's to write. Narrowing FURTHER per mode happens in
  // `editableFields` below.
  const allEditableFields = useMemo(() => {
    if (!resource) return []
    return resource.fields.filter(
      (f): f is typeof f & { id: string } =>
        f.capabilities?.creatable !== false && !f.capabilities?.hidden && !!f.id
    )
  }, [resource])

  // ─── Config Mode State ──────────────────────────────────────────────────────

  // Draft-buffer editing of the org's default view for a context, shared with the
  // property-panel drawer. `contextType` is only the context config mode OPENS
  // on — `draftContextType` is what it currently edits, and the Create/Edit tab
  // moves it independently of the dialog's own mode.
  const {
    draft,
    isDraftMode,
    isDraftDirty,
    isSaving,
    draftContextType,
    enterDraft,
    cancelDraft,
    switchDraftContext,
    setDraftVisibility,
    reorderDraft,
    saveDraft,
    draftGroups,
    addGroup,
    renameGroup,
    deleteGroup,
    assignFieldToGroup,
    moveGroup,
  } = useFieldViewDraft({ entityDefinitionId, contextType, fields: allEditableFields })

  // Use field view for visibility/ordering (normal mode only). `config` carries
  // the saved groups read mode renders sections from.
  const { config: viewConfig, getVisibleFields } = useFieldView({
    entityDefinitionId,
    contextType,
    fields: allEditableFields,
    enabled: allEditableFields.length > 0,
  })

  // Field IDs in baseline order — the merge baseline for config mode
  const fieldIds = useMemo(() => allEditableFields.map(viewFieldId), [allEditableFields])

  // DnD sensors for config mode
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Confirm dialog for discarding unsaved view edits (the X and the Create/Edit
  // tab both route through it) and for deleting a populated group.
  const [confirmDraft, ConfirmDraftDialog] = useConfirm()

  // ─── Config Mode Handlers ──────────────────────────────────────────────────

  // The field half of drop routing, shared verbatim with the property panel.
  const { handleFieldDragEnd, placeFieldBesideGroup } = useFieldGroupDnd({
    draft,
    draftGroups,
    assignFieldToGroup,
    reorderDraft,
  })

  /** The group whose label input should take focus (just created in this session). */
  const [newGroupId, setNewGroupId] = useState<string | null>(null)

  const handleAddGroup = () => setNewGroupId(addGroup('New group'))

  const handleDeleteGroup = async (groupId: string, label: string) => {
    // An EMPTY group has nothing to lose — no field changes hands and the draft
    // is still discardable with Cancel — so a confirm is pure friction on the
    // most likely case: created one by mistake, remove it again.
    const memberCount = draftGroups.find((g) => g.id === groupId)?.fieldIds.length ?? 0
    if (memberCount === 0) {
      deleteGroup(groupId)
      return
    }

    const confirmed = await confirmDraft({
      title: 'Delete group?',
      description: `"${label}" will be removed and its ${memberCount} field${memberCount === 1 ? '' : 's'} become ungrouped. No field is deleted — only the group.`,
      confirmText: 'Delete group',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) deleteGroup(groupId)
  }

  /**
   * "Save or discard?" — the prompt both silent-discard exits now route through.
   *
   * Ordering-only edits made losing a draft an annoyance; a half-built group is
   * real work. Saving here is exactly Save View: the same `saveDraft`, one
   * config write.
   */
  const askToSaveDraft = useCallback(
    () =>
      confirmDraft({
        title: 'Save changes to this view?',
        description:
          'Your changes to the field layout have not been saved. Saving applies them for everyone in the organization.',
        confirmText: 'Save',
        cancelText: 'Discard',
      }),
    [confirmDraft]
  )

  /**
   * The X out of config mode. Unlike the footer's Cancel — which sits beside
   * Save View, so the choice has already been put to the user — this reads as
   * "close this", not "throw my work away".
   *
   * `saveDraft` never rejects: on failure it toasts and leaves the draft intact,
   * so a failed save keeps the user in config mode with their changes rather
   * than closing over them.
   */
  const handleExitDraft = useCallback(async () => {
    if (!isDraftDirty) {
      cancelDraft()
      return
    }
    if (await askToSaveDraft()) await saveDraft()
    else cancelDraft()
  }, [askToSaveDraft, cancelDraft, isDraftDirty, saveDraft])

  /**
   * The Create/Edit tab re-snapshots from the store, which drops the current
   * context's unsaved edits — so it asks first, exactly like the X.
   *
   * A successful `saveDraft` leaves config mode entirely, so the save branch
   * re-enters it: this is a tab switch, not an exit. A failed one aborts the
   * switch outright, leaving the user on the tab whose work is still unsaved.
   */
  const handleSwitchDraftContext = useCallback(
    async (next: ViewContextType) => {
      if (next === draftContextType) return
      if (isDraftDirty) {
        if (await askToSaveDraft()) {
          if (!(await saveDraft())) return
          enterDraft()
        }
      }
      switchDraftContext(next)
    },
    [askToSaveDraft, draftContextType, enterDraft, isDraftDirty, saveDraft, switchDraftContext]
  )

  // ─── Config Mode Derived State ────────────────────────────────────────────

  /** Fields ordered by the draft config (for config mode rendering) */
  const configModeFields = useMemo(() => {
    if (!draft) return []
    const fieldMap = new Map(allEditableFields.map((f) => [viewFieldId(f), f]))

    // The merge yields exactly the baseline ids, each once — a field missing from
    // the stored order is spliced in at its baseline anchor rather than appended
    // to the end, and ids for deleted fields are dropped.
    const groupedFieldIds = new Set((draft.fieldGroups ?? []).flatMap((group) => group.fieldIds))

    const mergedOrder = mergeFieldOrder({
      baseline: fieldIds,
      storedOrder: draft.fieldOrder,
      isTrailing: (fieldId) => {
        const field = fieldMap.get(fieldId)
        return field ? isTrailingMetadataField(field) : false
      },
      // A field absent from the draft's order belongs to no group, so it must
      // not anchor inside one — otherwise it renders within a group's block
      // without being a member.
      isGrouped: (fieldId) => groupedFieldIds.has(fieldId),
    })

    const ordered: typeof allEditableFields = []
    for (const fieldId of mergedOrder) {
      const field = fieldMap.get(fieldId)
      if (field) ordered.push(field)
    }
    return ordered
  }, [draft, allEditableFields, fieldIds])

  // Get editable fields: config mode shows all from draft, normal mode shows visible
  // fields the CURRENT mode can actually write.
  //
  // The mode split matters: this dialog used to gate on `creatable` alone, so a
  // create-only field stayed editable while EDITING, and the write went through —
  // the write path does not check `capabilities.updatable` (see
  // `field-hooks/register-hooks.ts`), so the flag is only ever as strong as the
  // surface honouring it. That put the dialog at odds with the table cell,
  // property panel and kanban card, which all refuse a field with
  // `updatable === false`.
  const editableFields = useMemo(() => {
    if (isDraftMode) return configModeFields
    return getVisibleFields().filter((f) =>
      isEditing ? f.capabilities?.updatable !== false : f.capabilities?.creatable !== false
    )
  }, [isDraftMode, configModeFields, getVisibleFields, isEditing])

  /**
   * The groups the list renders sections from: the unsaved draft's in config
   * mode, the saved org view's in normal mode. A group carries no position —
   * its header renders where its first member sits in the field order.
   */
  const renderedGroups = isDraftMode ? draftGroups : (viewConfig.fieldGroups ?? NO_GROUPS)

  // RecordIds for syncer
  const recordIds = useMemo(() => (recordId ? [recordId] : []), [recordId])

  // Build column IDs in ResourceFieldId format
  const columnIds = useMemo(
    () => editableFields.map((field) => field.resourceFieldId!),
    [editableFields]
  )

  const { getValue } = useFieldValueSyncer({
    recordIds,
    resourceFieldIds: columnIds,
    columnVisibility: {},
    enabled: !!recordId && columnIds.length > 0,
  })

  // Field values state: { fieldId: value }
  const [values, setValues] = useState<Record<string, unknown>>({})

  // Validation state: { fieldId: errorMessage }
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Track which fields have been touched for validation
  const [touched, setTouched] = useState<Set<string>>(new Set())

  // Track whether to keep dialog open after creating
  const [createMore, setCreateMore] = useState(false)

  // Track dirty state for unsaved changes warning
  const { isDirty, setInitial } = useDirtyCheck(values)

  // Surface dirty state to the host so it can guard navigation (Esc / outside
  // click on the dialog, breadcrumb back in the palette).
  useEffect(() => {
    onDirtyChange?.(isDirty || createExtension?.isDirty === true)
  }, [isDirty, createExtension?.isDirty, onDirtyChange])

  // Track if dialog has been initialized to prevent re-initialization on dependency changes
  const isInitialized = useRef(false)

  // Ref to the form container for focusing first field
  const formRef = useRef<HTMLDivElement>(null)

  /**
   * Focus the first input field in the form
   */
  const focusFirstField = useCallback(() => {
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      const firstInput = formRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), [contenteditable="true"]'
      )
      firstInput?.focus()
    }, 0)
  }, [])

  // Initialize form values when dialog opens (but only once per open/close cycle)
  useEffect(() => {
    if (open) {
      // Only initialize if not already initialized
      // This prevents form reset when editableFields or other deps change during editing
      if (isInitialized.current) return
      isInitialized.current = true

      const initValues: Record<string, unknown> = {}

      if (recordId) {
        for (const field of editableFields) {
          const storeValue = getValue(recordId, field.resourceFieldId!)
          if (storeValue !== undefined && storeValue !== null) {
            initValues[field.id] = formatToRawValue(storeValue, field.fieldType ?? 'TEXT')
          }
        }
      } else {
        // Create mode: use default values
        for (const field of editableFields) {
          if (field.defaultValue !== undefined) {
            initValues[field.id] = field.defaultValue
          }
        }

        // Apply preset values (overrides defaults)
        if (presetValues) {
          for (const [fieldId, value] of Object.entries(presetValues)) {
            if (value !== undefined && value !== null) {
              initValues[fieldId] = value
            }
          }
        }
      }

      setValues(initValues)
      setInitial(initValues)
      setErrors({})
      setTouched(new Set())
      focusFirstField()
    } else {
      // Reset initialization flag and config mode when dialog closes
      isInitialized.current = false
      cancelDraft()
    }
  }, [
    open,
    recordId,
    editableFields,
    presetValues,
    setInitial,
    getValue,
    focusFirstField,
    cancelDraft,
  ])

  // Canonical create hook — seeds record + field-value caches from the result so
  // the creating user sees the new row with no refetch (the create mutation
  // excludes the originating socket from its realtime event). Toasts on error.
  const { create: createRecord, isPending: isCreating } = useCreateRecord({ entityDefinitionId })

  // Field metadata provider for relationship sync
  const getFieldMetadata = useCallback(
    (fieldId: string) => {
      const field = editableFields.find((f) => f.id === fieldId)
      if (!field) return undefined
      return {
        type: field.fieldType!,
        relationship: field.options?.relationship,
      }
    },
    [editableFields]
  )

  // Save field values with Zustand store sync
  const { saveMultipleAsync, isPending: isSavingFields } = useSaveFieldValue({
    getFieldMetadata,
  })

  // Combined pending state
  const isPending = isCreating || isSavingFields

  /**
   * Handle field value change
   */
  const handleFieldChange = (fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }))
    setTouched((prev) => new Set(prev).add(fieldId))

    // Clear error when user edits
    if (errors[fieldId]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[fieldId]
        return next
      })
    }
  }

  /**
   * Validate all required fields
   */
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    for (const field of editableFields) {
      const isRequired = field.required ?? field.capabilities?.required
      if (isRequired) {
        const value = values[field.id!]
        if (value === undefined || value === null || value === '') {
          newErrors[field.id!] = `${field.label} is required`
        }
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  /**
   * Reset form state for creating another instance
   */
  const resetForm = useCallback(() => {
    const initValues: Record<string, unknown> = {}

    // Re-apply default values
    for (const field of editableFields) {
      if (field.defaultValue !== undefined) {
        initValues[field.id] = field.defaultValue
      }
    }

    // Re-apply preset values
    if (presetValues) {
      for (const [fieldId, value] of Object.entries(presetValues)) {
        if (value !== undefined && value !== null) {
          initValues[fieldId] = value
        }
      }
    }

    setValues(initValues)
    setInitial(initValues)
    setErrors({})
    setTouched(new Set())
    createExtension?.onReset?.()
  }, [editableFields, presetValues, setInitial, createExtension])

  const handleSubmit = async () => {
    if (!validate()) return

    try {
      let instanceId: string

      if (isEditing && editingInstanceId) {
        // Edit mode: update values via saveMultipleAsync
        instanceId = editingInstanceId
        const instanceRecordId = toRecordId(entityDefinitionId, instanceId)

        // NAME composites are split into their two part fields inside the save
        // funnel (`useSaveFieldValue`), so every commit path gets it.
        const valuesToSave = Object.entries(values)
          .filter(([_, value]) => value !== undefined && value !== null && value !== '')
          .map(([fieldId, value]) => {
            const field = editableFields.find((f) => f.id === fieldId)
            return { fieldId, value, fieldType: field?.fieldType ?? 'TEXT' }
          })

        if (valuesToSave.length > 0) {
          const success = await saveMultipleAsync(instanceRecordId, valuesToSave)
          if (!success) return
        }
      } else {
        // Create mode: single create call with values. `record.create` does
        // NOT go through the save funnel (`useSaveFieldValue`), so the NAME
        // composite is left intact here and decomposed server-side, at the
        // `setValueWithBuiltIn` chokepoint in
        // `packages/lib/src/field-values/field-value-mutations.ts` — reached
        // from create/update via `resources/crud/unified-handler.ts` ->
        // `setValuesForEntity`.
        const formValues = Object.fromEntries(
          Object.entries(values).filter(
            ([_, value]) => value !== undefined && value !== null && value !== ''
          )
        )
        Object.assign(formValues, createExtension?.values)

        // Create + seed in one step — hooks run server-side and auto-generate
        // fields like ticket_number (hydrated on the row's next read); the seed
        // renders the new row immediately without a refetch.
        const result = await createRecord({ values: formValues })
        instanceId = result.instanceId
      }

      onSaved?.(instanceId)

      // If createMore is enabled and we're in create mode, reset form instead of closing
      if (createMore && !isEditing) {
        resetForm()
        focusFirstField()
      } else {
        onClose()
      }
    } catch {
      // Errors handled by mutation onError
    }
  }

  /**
   * Groups holding a field that currently fails validation, so the list can
   * force them open.
   *
   * TWO ID KEYSPACES MEET HERE. `errors` is keyed by `field.id` (the form
   * keyspace); groups are keyed by the VIEW id (`resourceFieldId`, which for a
   * custom field is `<entityDefinitionId>:<fieldId>` — a genuinely different
   * string). The map therefore goes through the field OBJECT and never
   * string-matches one against the other.
   */
  const errorGroupIds = useMemo(() => {
    if (Object.keys(errors).length === 0 || renderedGroups.length === 0) return []
    const ids = new Set<string>()
    for (const field of editableFields) {
      if (!errors[field.id]) continue
      const viewId = viewFieldId(field)
      const group = renderedGroups.find((g) => g.fieldIds.includes(viewId))
      if (group) ids.add(group.id)
    }
    return [...ids]
  }, [errors, editableFields, renderedGroups])

  const resourceLabel = resource?.label ?? 'Record'

  const title = isDraftMode
    ? `Customize ${resourceLabel} Fields`
    : isEditing
      ? `Edit ${resourceLabel}`
      : `New ${resourceLabel}`
  const description = isDraftMode
    ? 'Drag to reorder and toggle field visibility.'
    : isEditing
      ? `Update the ${resourceLabel.toLowerCase()} details below.`
      : `Enter the details for the new ${resourceLabel.toLowerCase()}.`

  /** Shared by both modes — one list component, one drag model, one collapse state. */
  const renderFieldList = (renderRow: FieldListRowRenderer) => (
    <FieldGroupList<ResourceField>
      rows={editableFields}
      rowId={viewFieldId}
      rowKey={(field) => String(field.id ?? field.key)}
      groups={renderedGroups}
      isEditMode={isDraftMode}
      sensors={sensors}
      onFieldDragEnd={handleFieldDragEnd}
      onPlaceFieldBesideGroup={placeFieldBesideGroup}
      onMoveGroup={moveGroup}
      onRenameGroup={renameGroup}
      onDeleteGroup={handleDeleteGroup}
      newGroupId={newGroupId}
      groupedRowClassName={GROUPED_ROW_CLASS}
      groupClassName={GROUP_HEADER_CLASS}
      forceExpandGroupIds={errorGroupIds}
      renderRow={renderRow}
    />
  )

  return (
    <>
      <ConfirmDraftDialog />
      {header?.({ title, description })}

      {/* Field card area — floating edit button anchored to its top-right corner */}
      <div className='relative group/field-card'>
        {/* Floating edit button — matches entity-fields panel placement. This is
            the ONLY caller of `enterDraft`, so gating it here is what makes the
            whole of config mode unreachable without def administration. */}
        {canConfigureView && (
          <div
            className={cn(
              'absolute -top-4 -right-3 z-80 rounded-full transition-opacity duration-200 ring ring-border bg-background flex items-center justify-center size-7 shadow-md backdrop-blur-sm',
              isDraftMode ? 'opacity-100' : 'opacity-0 group-hover/field-card:opacity-100'
            )}>
            <Button
              variant='ghost'
              size='icon-xs'
              onClick={() => (isDraftMode ? void handleExitDraft() : enterDraft())}
              className={cn(
                'cursor-pointer',
                isDraftMode
                  ? 'bg-bad-200 hover:bg-bad-200 text-bad-700 hover:text-bad-800'
                  : 'text-muted-foreground hover:text-foreground'
              )}>
              {isDraftMode ? <X /> : <Pencil />}
            </Button>
          </div>
        )}

        {isDraftMode ? (
          /* Config mode: grouped, draggable field list with visibility switches.
             No resizeId here — the resize strip would steal pointer-downs from
             the row drag-and-drop, and group-header drags make that worse.
             `rowBorders='managed'`: group wrappers nest the rows, which defeats
             the panel's direct-child last-row rule. */
          <>
            <FieldPanel className='p-0' breakpoint='md' rowBorders='managed'>
              {renderFieldList((field, ctx) => {
                const fieldKey = viewFieldId(field)
                return (
                  <DialogFieldConfigRow
                    id={fieldKey}
                    label={field.label ?? field.name ?? field.key}
                    isVisible={draft?.fieldVisibility[fieldKey] !== false}
                    // A preview row is the drag ghost: withholding the handler
                    // is what collapses it to grip + name.
                    onToggleVisibility={
                      ctx.preview ? undefined : (visible) => setDraftVisibility(fieldKey, visible)
                    }
                    isLastRow={ctx.isLast}
                  />
                )
              })}
            </FieldPanel>
            {/* Field DEFINITION administration lives in the property panel and
                settings, so there is no Add Field counterpart here. The panel is
                a bordered card in this surface, not a bare list, so the row
                needs its own clearance from the edge. */}
            <AddGroupRow onClick={handleAddGroup} className='mt-2 ms-0' />
          </>
        ) : (
          /* Normal mode: form inputs */
          <>
            <div ref={formRef}>
              <FieldPanel
                className='p-0'
                breakpoint='md'
                rowBorders='managed'
                resizeId={`entity-instance:${entityDefinitionId}`}>
                {renderFieldList((field, ctx) => (
                  <FieldInputRow
                    field={field}
                    value={values[field.id] ?? ''}
                    onChange={handleFieldChange}
                    validationError={
                      touched.has(field.id) || Object.keys(errors).length > 0
                        ? errors[field.id]
                        : undefined
                    }
                    validationType='error'
                    disabled={isPending}
                    isLastRow={ctx.isLast}
                  />
                ))}
              </FieldPanel>
              {/* Outside every group, after the sections. */}
              {!isEditing && createExtension?.content}
            </div>

            {editableFields.length === 0 && (
              <div className='text-sm text-muted-foreground text-center py-8'>
                No fields defined for this entity type.
                <br />
                Add custom fields in the entity definition settings.
              </div>
            )}
          </>
        )}
      </div>

      {isDraftMode ? (
        <DialogFooter className='sm:justify-between'>
          {/* Left side: Context type toggle (Create / Edit) */}
          <RadioTab
            value={draftContextType}
            onValueChange={(value) => void handleSwitchDraftContext(value as ViewContextType)}
            size='sm'
            radioGroupClassName='rounded-xl'
            className='h-7'>
            <RadioTabItem value='dialog_create' disabled={isSaving}>
              Create
            </RadioTabItem>
            <RadioTabItem value='dialog_edit' disabled={isSaving}>
              Edit
            </RadioTabItem>
          </RadioTab>

          {/* Right side: Cancel + Save View */}
          <div className='flex items-center gap-2'>
            <Button size='sm' variant='ghost' onClick={cancelDraft} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() => void saveDraft()}
              loading={isSaving}
              loadingText='Saving...'>
              Save View
            </Button>
          </div>
        </DialogFooter>
      ) : (
        <DialogFooter className='sm:justify-between'>
          {/* Left side: Create more toggle (only in create mode) */}
          <div>
            {!isEditing && (
              <label
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'gap-2 cursor-pointer'
                )}>
                <span className='text-muted-foreground text-xs'>Create more</span>
                <Switch
                  size='sm'
                  checked={createMore}
                  onCheckedChange={setCreateMore}
                  disabled={isPending}
                />
              </label>
            )}
          </div>

          {/* Right side: Action buttons */}
          <div className='flex items-center gap-2'>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={onRequestClose}
              disabled={isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={handleSubmit}
              loading={isPending}
              loadingText={isEditing ? 'Saving...' : 'Creating...'}
              disabled={editableFields.length === 0}
              data-dialog-submit>
              {isEditing ? 'Save Changes' : `Create ${resourceLabel}`}{' '}
              <KbdSubmit variant='outline' size='sm' />
            </Button>
          </div>
        </DialogFooter>
      )}
    </>
  )
}
