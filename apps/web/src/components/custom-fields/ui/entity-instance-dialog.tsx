// apps/web/src/components/custom-fields/ui/entity-instance-dialog.tsx
'use client'

import {
  createDefaultFieldViewConfig,
  type FieldViewConfig,
  type ViewContextType,
} from '@auxx/lib/conditions/client'
import { formatToRawValue } from '@auxx/lib/field-values/client'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Button, buttonVariants } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDynamicTableStore } from '~/components/dynamic-table/stores/dynamic-table-store'
import { useOrgFieldView } from '~/components/dynamic-table/stores/store-selectors'
import { useFieldView } from '~/components/fields/hooks/use-field-view'
import { useResource } from '~/components/resources'
import { useFieldValueSyncer } from '~/components/resources/hooks/use-field-value-syncer'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { api } from '~/trpc/react'
import { DialogFieldConfigRow } from './dialog-field-config-row'
import { FieldInputRow } from './field-input-row'

interface EntityInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Entity definition ID */
  entityDefinitionId: string
  /** RecordId for edit mode (format: "entityDefinitionId:entityInstanceId"), undefined for create */
  recordId?: RecordId
  /** Callback after successful save */
  onSaved?: (instanceId: string) => void
  /** Preset field values for CREATE mode. Format: { fieldId: value } */
  presetValues?: Record<string, unknown>
}

/**
 * Dialog for creating/editing entity instances.
 * Uses useResource to get field definitions and useFieldValueSyncer for values.
 */
export function EntityInstanceDialog({
  open,
  onOpenChange,
  entityDefinitionId,
  recordId,
  onSaved,
  presetValues,
}: EntityInstanceDialogProps) {
  // Parse recordId to get instance ID for editing
  const editingInstanceId = recordId ? parseRecordId(recordId).entityInstanceId : undefined
  const isEditing = !!editingInstanceId

  // Get resource definition with fields
  const { resource } = useResource(entityDefinitionId)

  // Determine context type based on mode (for normal form rendering)
  const contextType = isEditing ? 'dialog_edit' : 'dialog_create'

  // Get all potentially editable fields first
  const allEditableFields = useMemo(() => {
    if (!resource) return []
    return resource.fields
      .filter((f): f is typeof f & { id: string } => f.capabilities?.creatable !== false && !!f.id)
      .sort((a, b) => (a.sortOrder ?? '').localeCompare(b.sortOrder ?? ''))
  }, [resource])

  // ─── Config Mode State ──────────────────────────────────────────────────────

  /** Whether config mode is active */
  const [isConfigMode, setIsConfigMode] = useState(false)

  /** Which context is being configured (independent of isEditing in config mode) */
  const [configContextType, setConfigContextType] = useState<ViewContextType>('dialog_create')

  /** Draft config: local buffer for batch save (null when not in config mode) */
  const [draftConfig, setDraftConfig] = useState<FieldViewConfig | null>(null)

  // Use field view for visibility/ordering (normal mode only)
  const { getVisibleFields } = useFieldView({
    entityDefinitionId,
    contextType,
    fields: allEditableFields,
    enabled: allEditableFields.length > 0,
  })

  // Field IDs for creating default configs
  const fieldIds = useMemo(
    () => allEditableFields.map((f) => f.resourceFieldId ?? f.id ?? f.key),
    [allEditableFields]
  )

  // Org field view for the config context type (used for save-vs-create logic)
  const configOrgFieldView = useOrgFieldView(entityDefinitionId, configContextType)

  // Store action for adding newly created views
  const addView = useDynamicTableStore((s) => s.addView)

  // Mutations for persisting view config on "Save View"
  const updateViewMutation = api.tableView.update.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to save view', description: error.message })
    },
  })
  const createViewMutation = api.tableView.create.useMutation({
    onSuccess: (newView) => {
      addView(newView)
    },
    onError: (error) => {
      toastError({ title: 'Failed to create view', description: error.message })
    },
  })

  // DnD sensors for config mode
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // ─── Config Mode Handlers ──────────────────────────────────────────────────

  /** Snapshot a FieldViewConfig for the given context type from the store */
  const snapshotConfigForContext = useCallback(
    (ct: ViewContextType): FieldViewConfig => {
      const state = useDynamicTableStore.getState()
      const views = state.viewsByTableId[entityDefinitionId] ?? []
      const view = views.find((v) => v.contextType === ct && v.isDefault && v.isShared)
      const storedConfig = view?.config as FieldViewConfig | undefined
      const baseConfig = storedConfig ?? createDefaultFieldViewConfig(fieldIds)

      // Ensure all current field IDs are represented (handles newly added fields)
      const existingOrderSet = new Set(baseConfig.fieldOrder)
      const missingFields = fieldIds.filter((id) => !existingOrderSet.has(id))

      return {
        ...baseConfig,
        fieldOrder: [...baseConfig.fieldOrder, ...missingFields],
        fieldVisibility: {
          ...baseConfig.fieldVisibility,
          ...Object.fromEntries(missingFields.map((id) => [id, true])),
        },
      }
    },
    [entityDefinitionId, fieldIds]
  )

  /** Enter config mode: snapshot current config into draft */
  const enterConfigMode = useCallback(() => {
    setConfigContextType(contextType)
    setDraftConfig(snapshotConfigForContext(contextType))
    setIsConfigMode(true)
  }, [contextType, snapshotConfigForContext])

  /** Cancel config mode: discard draft, exit */
  const handleCancelConfig = useCallback(() => {
    setDraftConfig(null)
    setIsConfigMode(false)
  }, [])

  /** Switch which context type is being configured */
  const switchConfigContext = useCallback(
    (newContextType: ViewContextType) => {
      setConfigContextType(newContextType)
      setDraftConfig(snapshotConfigForContext(newContextType))
    },
    [snapshotConfigForContext]
  )

  /** Toggle field visibility in draft (no server call) */
  const handleDraftToggle = useCallback((fieldKey: string, visible: boolean) => {
    setDraftConfig((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        fieldVisibility: { ...prev.fieldVisibility, [fieldKey]: visible },
      }
    })
  }, [])

  /** Reorder field in draft via drag-and-drop (no server call) */
  const handleDraftDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setDraftConfig((prev) => {
      if (!prev) return prev
      const fromIndex = prev.fieldOrder.indexOf(String(active.id))
      const toIndex = prev.fieldOrder.indexOf(String(over.id))
      if (fromIndex === -1 || toIndex === -1) return prev

      const newOrder = [...prev.fieldOrder]
      const [moved] = newOrder.splice(fromIndex, 1)
      if (!moved) return prev
      newOrder.splice(toIndex, 0, moved)

      return { ...prev, fieldOrder: newOrder }
    })
  }, [])

  /** Save View: persist draft to server, update store, exit config mode */
  const handleSaveView = useCallback(async () => {
    if (!draftConfig) return

    try {
      if (configOrgFieldView) {
        // Update existing view
        await updateViewMutation.mutateAsync({
          id: configOrgFieldView.id,
          config: draftConfig,
        })
        // Update the view config in the store (immer allows direct mutation)
        useDynamicTableStore.setState((state) => {
          const views = state.viewsByTableId[entityDefinitionId]
          if (!views) return
          const view = views.find((v) => v.id === configOrgFieldView.id)
          if (view) view.config = draftConfig
        })
      } else {
        // Create new view (addView called via onSuccess)
        await createViewMutation.mutateAsync({
          tableId: entityDefinitionId,
          name: 'Default Dialog View',
          contextType: configContextType,
          isShared: true,
          isDefault: true,
          config: draftConfig,
        })
      }

      // Exit config mode
      setDraftConfig(null)
      setIsConfigMode(false)
    } catch {
      // Errors handled by mutation onError
    }
  }, [
    draftConfig,
    configOrgFieldView,
    configContextType,
    entityDefinitionId,
    updateViewMutation,
    createViewMutation,
  ])

  // ─── Config Mode Derived State ────────────────────────────────────────────

  /** Fields ordered by draft config (for config mode rendering) */
  const configModeFields = useMemo(() => {
    if (!draftConfig) return []
    const { fieldOrder } = draftConfig
    const fieldMap = new Map(
      allEditableFields.map((f) => [String(f.resourceFieldId ?? f.id ?? f.key), f])
    )

    const ordered: typeof allEditableFields = []
    for (const fieldId of fieldOrder) {
      const field = fieldMap.get(fieldId)
      if (field) {
        ordered.push(field)
        fieldMap.delete(fieldId)
      }
    }
    // Append any fields not in the order
    for (const [, field] of fieldMap) {
      ordered.push(field)
    }
    return ordered
  }, [draftConfig, allEditableFields])

  // Get editable fields: config mode shows all from draft, normal mode shows visible
  const editableFields = useMemo(() => {
    return isConfigMode ? configModeFields : getVisibleFields()
  }, [isConfigMode, configModeFields, getVisibleFields])

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

  // Stable callback for closing the dialog
  const handleConfirmedClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  // Guard against accidental close when dirty
  const { guardProps, guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: handleConfirmedClose,
  })

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
      setIsConfigMode(false)
      setDraftConfig(null)
    }
  }, [open, recordId, editableFields, presetValues, setInitial, getValue, focusFirstField])

  // Create instance mutation
  const createInstance = api.record.create.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to create', description: error.message })
    },
  })

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
  const isPending = createInstance.isPending || isSavingFields

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
  }, [editableFields, presetValues, setInitial])

  /**
   * Handle form submission
   */
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

        // Create instance with values - hooks run and auto-generate fields like ticket_number
        const result = await createInstance.mutateAsync({
          entityDefinitionId,
          values: formValues,
        })

        instanceId = result.instance.id

        // The returned values include auto-generated fields (e.g., ticket_number)
        // These are already saved to the database by the handler
        // The field value store will be hydrated on next fetch
      }

      onSaved?.(instanceId)

      // If createMore is enabled and we're in create mode, reset form instead of closing
      if (createMore && !isEditing) {
        resetForm()
        focusFirstField()
      } else {
        onOpenChange(false)
      }
    } catch {
      // Errors handled by mutation onError
    }
  }

  const resourceLabel = resource?.label ?? 'Record'
  const isSavingView = updateViewMutation.isPending || createViewMutation.isPending

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size='md' position='tc' {...guardProps}>
          <DialogHeader>
            <DialogTitle>
              {isConfigMode
                ? `Customize ${resourceLabel} Fields`
                : isEditing
                  ? `Edit ${resourceLabel}`
                  : `New ${resourceLabel}`}
            </DialogTitle>
            <DialogDescription>
              {isConfigMode
                ? 'Drag to reorder and toggle field visibility.'
                : isEditing
                  ? `Update the ${resourceLabel.toLowerCase()} details below.`
                  : `Enter the details for the new ${resourceLabel.toLowerCase()}.`}
            </DialogDescription>
          </DialogHeader>

          {/* Field card area — floating edit button anchored to its top-right corner */}
          <div className='relative group/field-card'>
            {/* Floating edit button — matches entity-fields panel placement */}
            <div
              className={cn(
                'absolute -top-4 -right-3 z-80 rounded-full transition-opacity duration-200 ring ring-border bg-background flex items-center justify-center size-7 shadow-md backdrop-blur-sm',
                isConfigMode ? 'opacity-100' : 'opacity-0 group-hover/field-card:opacity-100'
              )}>
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={() => (isConfigMode ? handleCancelConfig() : enterConfigMode())}
                className={cn(
                  'cursor-pointer',
                  isConfigMode
                    ? 'bg-bad-200 hover:bg-bad-200 text-bad-700 hover:text-bad-800'
                    : 'text-muted-foreground hover:text-foreground'
                )}>
                {isConfigMode ? <X /> : <Pencil />}
              </Button>
            </div>

            {isConfigMode ? (
              /* Config mode: sortable field list with visibility switches */
              <VarEditorField className='p-0'>
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
                          isVisible={draftConfig?.fieldVisibility[fieldKey] !== false}
                          onToggleVisibility={(visible) => handleDraftToggle(fieldKey, visible)}
                        />
                      )
                    })}
                  </SortableContext>
                </DndContext>
              </VarEditorField>
            ) : (
              /* Normal mode: form inputs */
              <>
                <div ref={formRef}>
                  <VarEditorField className='p-0'>
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
                  </VarEditorField>
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

          {isConfigMode ? (
            <DialogFooter className='sm:justify-between'>
              {/* Left side: Context type toggle (Create / Edit) */}
              <RadioTab
                value={configContextType}
                onValueChange={switchConfigContext}
                size='sm'
                radioGroupClassName='rounded-xl'
                className='h-7'>
                <RadioTabItem value='dialog_create' disabled={isSavingView}>
                  Create
                </RadioTabItem>
                <RadioTabItem value='dialog_edit' disabled={isSavingView}>
                  Edit
                </RadioTabItem>
              </RadioTab>

              {/* Right side: Cancel + Save View */}
              <div className='flex items-center gap-2'>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={handleCancelConfig}
                  disabled={isSavingView}>
                  Cancel
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={handleSaveView}
                  loading={isSavingView}
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
                  onClick={guardedClose}
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
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
