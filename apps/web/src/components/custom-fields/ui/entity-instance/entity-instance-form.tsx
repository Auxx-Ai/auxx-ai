// apps/web/src/components/custom-fields/ui/entity-instance/entity-instance-form.tsx
'use client'

import { formatToRawValue } from '@auxx/lib/field-values/client'
import {
  isTrailingMetadataField,
  parseRecordId,
  type RecordId,
  toRecordId,
} from '@auxx/lib/resources/client'
import { Button, buttonVariants } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Pencil, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFieldView } from '~/components/fields/hooks/use-field-view'
import { useFieldViewDraft } from '~/components/fields/hooks/use-field-view-draft'
import { mergeFieldOrder } from '~/components/fields/merge-field-order'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { useResource } from '~/components/resources'
import { useCreateRecord } from '~/components/resources/hooks/use-create-record'
import { useFieldValueSyncer } from '~/components/resources/hooks/use-field-value-syncer'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { DialogFieldConfigRow } from '../dialog-field-config-row'
import { FieldInputRow } from '../field-input-row'

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

  // Get all potentially editable fields first. `resource.fields` already arrives
  // in baseline order — `ORDER BY sortOrder ASC` server-side, then partitioned by
  // `sortFieldsWithMetadataLast` — so no re-sort here; re-sorting by raw
  // `sortOrder` would discard that partition and make this surface define
  // "baseline" differently from the property panel.
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
    isSaving,
    draftContextType,
    enterDraft,
    cancelDraft,
    switchDraftContext,
    setDraftVisibility,
    reorderDraft,
    saveDraft,
  } = useFieldViewDraft({ entityDefinitionId, contextType, fields: allEditableFields })

  // Use field view for visibility/ordering (normal mode only)
  const { getVisibleFields } = useFieldView({
    entityDefinitionId,
    contextType,
    fields: allEditableFields,
    enabled: allEditableFields.length > 0,
  })

  // Field IDs in baseline order — the merge baseline for config mode
  const fieldIds = useMemo(
    () => allEditableFields.map((f) => String(f.resourceFieldId ?? f.id ?? f.key)),
    [allEditableFields]
  )

  // DnD sensors for config mode
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // ─── Config Mode Handlers ──────────────────────────────────────────────────

  /** dnd-kit adapter over the draft hook's index-free reorder */
  const handleDraftDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      reorderDraft(String(active.id), String(over.id))
    },
    [reorderDraft]
  )

  // ─── Config Mode Derived State ────────────────────────────────────────────

  /** Fields ordered by the draft config (for config mode rendering) */
  const configModeFields = useMemo(() => {
    if (!draft) return []
    const fieldMap = new Map(
      allEditableFields.map((f) => [String(f.resourceFieldId ?? f.id ?? f.key), f])
    )

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
  const editableFields = useMemo(() => {
    return isDraftMode ? configModeFields : getVisibleFields()
  }, [isDraftMode, configModeFields, getVisibleFields])

  // Sortable IDs for DnD (all fields in config mode)
  const sortableFieldIds = useMemo(
    () => editableFields.map((f) => f.resourceFieldId ?? f.id ?? f.key),
    [editableFields]
  )

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

  /**
   * Expand NAME field values into their source fields (firstName, lastName).
   * Returns a new values object with NAME fields replaced by their source TEXT fields.
   */
  const expandNameFields = useCallback(
    (vals: Record<string, unknown>): Record<string, unknown> => {
      const expanded: Record<string, unknown> = {}

      for (const [fieldId, value] of Object.entries(vals)) {
        const field = editableFields.find((f) => f.id === fieldId)
        if (field?.fieldType === 'NAME' && field.options?.name) {
          // Split NAME into source fields
          const { firstNameFieldId, lastNameFieldId } = field.options.name
          const nameVal = value as { firstName?: string; lastName?: string } | null
          if (nameVal) {
            if (nameVal.firstName !== undefined) expanded[firstNameFieldId] = nameVal.firstName
            if (nameVal.lastName !== undefined) expanded[lastNameFieldId] = nameVal.lastName
          }
          // Don't include the NAME field itself
        } else {
          expanded[fieldId] = value
        }
      }

      return expanded
    },
    [editableFields]
  )

  const handleSubmit = async () => {
    if (!validate()) return

    try {
      let instanceId: string

      if (isEditing && editingInstanceId) {
        // Edit mode: update values via saveMultipleAsync
        instanceId = editingInstanceId
        const instanceRecordId = toRecordId(entityDefinitionId, instanceId)

        // Expand NAME fields into source fields before saving
        const expandedValues = expandNameFields(values)

        // Save all field values
        const valuesToSave = Object.entries(expandedValues)
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
        // Create mode: single create call with values
        // Expand NAME fields and build values object from form state
        const formValues = Object.fromEntries(
          Object.entries(expandNameFields(values)).filter(
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

  return (
    <>
      {header?.({ title, description })}

      {/* Field card area — floating edit button anchored to its top-right corner */}
      <div className='relative group/field-card'>
        {/* Floating edit button — matches entity-fields panel placement */}
        <div
          className={cn(
            'absolute -top-4 -right-3 z-80 rounded-full transition-opacity duration-200 ring ring-border bg-background flex items-center justify-center size-7 shadow-md backdrop-blur-sm',
            isDraftMode ? 'opacity-100' : 'opacity-0 group-hover/field-card:opacity-100'
          )}>
          <Button
            variant='ghost'
            size='icon-xs'
            onClick={() => (isDraftMode ? cancelDraft() : enterDraft())}
            className={cn(
              'cursor-pointer',
              isDraftMode
                ? 'bg-bad-200 hover:bg-bad-200 text-bad-700 hover:text-bad-800'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            {isDraftMode ? <X /> : <Pencil />}
          </Button>
        </div>

        {isDraftMode ? (
          /* Config mode: sortable field list with visibility switches.
             No resizeId here — the resize strip would steal pointer-downs from
             the row drag-and-drop. */
          <FieldPanel className='p-0'>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDraftDragEnd}
              modifiers={[restrictToVerticalAxis]}>
              <SortableContext items={sortableFieldIds} strategy={verticalListSortingStrategy}>
                {editableFields.map((field) => {
                  const fieldKey = field.resourceFieldId ?? field.id ?? field.key
                  return (
                    <DialogFieldConfigRow
                      key={fieldKey}
                      id={fieldKey}
                      label={field.label ?? field.name ?? field.key}
                      isVisible={draft?.fieldVisibility[fieldKey] !== false}
                      onToggleVisibility={(visible) => setDraftVisibility(fieldKey, visible)}
                    />
                  )
                })}
              </SortableContext>
            </DndContext>
          </FieldPanel>
        ) : (
          /* Normal mode: form inputs */
          <>
            <div ref={formRef}>
              <FieldPanel
                className='p-0'
                breakpoint='md'
                resizeId={`entity-instance:${entityDefinitionId}`}>
                {editableFields.map((field) => (
                  <FieldInputRow
                    key={field.id}
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
                  />
                ))}
              </FieldPanel>
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
            onValueChange={switchDraftContext}
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
              onClick={saveDraft}
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
