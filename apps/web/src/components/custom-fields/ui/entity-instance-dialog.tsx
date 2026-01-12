// apps/web/src/components/custom-fields/ui/entity-instance-dialog.tsx
'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { useDialogSubmit } from '@auxx/ui/hooks'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { FieldInputRow } from './field-input-row'
import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { useSaveFieldValue } from '~/hooks/use-save-field-value'
import { useResource } from '~/components/resources'
import { useCustomFieldValueSyncer } from '~/hooks/use-custom-field-value-syncer'
import { formatToRawValue } from '@auxx/lib/field-values/client'

interface EntityInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Entity definition ID */
  entityDefinitionId: string
  /** Existing instance ID for edit mode, null/undefined for create */
  editingInstanceId?: string | null
  /** Callback after successful save */
  onSaved?: (instanceId: string) => void
}

/**
 * Dialog for creating/editing entity instances.
 * Uses useResource to get field definitions and useCustomFieldValueSyncer for values.
 */
export function EntityInstanceDialog({
  open,
  onOpenChange,
  entityDefinitionId,
  editingInstanceId,
  onSaved,
}: EntityInstanceDialogProps) {
  const isEditing = !!editingInstanceId
  const utils = api.useUtils()

  // Get resource definition with fields
  const { resource } = useResource(entityDefinitionId)

  // Get editable fields (exclude system fields like id, createdAt, updatedAt)
  const editableFields = useMemo(() => {
    if (!resource) return []
    return resource.fields
      .filter((f): f is typeof f & { id: string } => f.capabilities?.creatable !== false && !!f.id)
      .sort((a, b) => (a.sortOrder ?? '').localeCompare(b.sortOrder ?? ''))
  }, [resource])

  // Column IDs for syncer
  const customFieldColumnIds = useMemo(
    () => editableFields.map((f) => `customField_${f.id}`),
    [editableFields]
  )

  // Get values from store for edit mode
  const { getValue } = useCustomFieldValueSyncer({
    resourceType: 'entity',
    entityDefId: entityDefinitionId,
    rowIds: editingInstanceId ? [editingInstanceId] : [],
    customFieldColumnIds,
    columnVisibility: {},
    enabled: !!editingInstanceId && editableFields.length > 0,
  })

  // Field values state: { fieldId: value }
  const [values, setValues] = useState<Record<string, unknown>>({})

  // Validation state: { fieldId: errorMessage }
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Track which fields have been touched for validation
  const [touched, setTouched] = useState<Set<string>>(new Set())

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

  // Initialize form values when dialog opens
  useEffect(() => {
    if (open) {
      const initValues: Record<string, unknown> = {}

      if (editingInstanceId) {
        // Edit mode: populate from store values
        for (const field of editableFields) {
          const storeValue = getValue(editingInstanceId, field.id)
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
      }

      setValues(initValues)
      setInitial(initValues)
      setErrors({})
      setTouched(new Set())
    }
  }, [open, editingInstanceId, editableFields, setInitial, getValue])

  // Create instance mutation
  const createInstance = api.entityInstance.create.useMutation({
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
    resourceType: 'entity',
    entityDefId: entityDefinitionId,
    modelType: 'entity',
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
   * Handle form submission
   */
  const handleSubmit = async () => {
    if (!validate()) return

    try {
      let instanceId: string

      if (isEditing && editingInstanceId) {
        // Edit mode: just update values
        instanceId = editingInstanceId
      } else {
        // Create mode: create instance first
        const created = await createInstance.mutateAsync({
          entityDefinitionId,
        })
        instanceId = created.id
      }

      // Save all field values with Zustand store sync
      const valuesToSave = Object.entries(values)
        .filter(([_, value]) => value !== undefined && value !== null && value !== '')
        .map(([fieldId, value]) => {
          const field = editableFields.find((f) => f.id === fieldId)
          return { fieldId, value, fieldType: field?.fieldType }
        })

      if (valuesToSave.length > 0) {
        const success = await saveMultipleAsync(instanceId, valuesToSave)
        if (!success) return // Error already handled by hook
      }

      // Invalidate queries
      await utils.entityInstance.list.invalidate()

      onSaved?.(instanceId)
      onOpenChange(false)
    } catch {
      // Errors handled by mutation onError
    }
  }

  const resourceLabel = resource?.label ?? 'Record'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md" position="tc" {...guardProps}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? `Edit ${resourceLabel}` : `New ${resourceLabel}`}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? `Update the ${resourceLabel.toLowerCase()} details below.`
                : `Enter the details for the new ${resourceLabel.toLowerCase()}.`}
            </DialogDescription>
          </DialogHeader>

          <VarEditorField className="p-0">
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
                validationType="error"
                disabled={isPending}
              />
            ))}
          </VarEditorField>

          {editableFields.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              No fields defined for this entity type.
              <br />
              Add custom fields in the entity definition settings.
            </div>
          )}

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
              size="sm"
              variant="outline"
              onClick={handleSubmit}
              loading={isPending}
              loadingText={isEditing ? 'Saving...' : 'Creating...'}
              disabled={editableFields.length === 0}>
              {isEditing ? 'Save Changes' : `Create ${resourceLabel}`} <KbdSubmit variant="outline" size="sm" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
