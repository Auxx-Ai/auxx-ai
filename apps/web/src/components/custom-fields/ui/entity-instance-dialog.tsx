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
import { Button } from '@auxx/ui/components/button'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { FieldInputRow } from './field-input-row'
import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { useSaveFieldValue } from '~/hooks/use-save-field-value'
import type { FieldType } from '@auxx/database/types'

/**
 * Custom field definition type
 */
interface CustomFieldDef {
  id: string
  name: string
  type: FieldType
  description?: string | null
  required?: boolean | null
  position?: number | null
  active?: boolean | null
  defaultValue?: string | null
  options?: unknown
}

/**
 * Entity definition with custom fields loaded
 */
interface EntityDefinitionWithFields {
  id: string
  singular: string
  plural: string
  icon?: string | null
  color?: string | null
  customFields: CustomFieldDef[]
}

/**
 * Field value from entity instance
 */
interface FieldValue {
  id: string
  fieldId: string
  value: unknown
  field: CustomFieldDef
}

/**
 * Entity instance with field values
 */
interface EntityInstanceWithValues {
  id: string
  entityDefinitionId: string
  values?: FieldValue[]
}

interface EntityInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Entity definition (required) */
  entityDefinition: EntityDefinitionWithFields
  /** Existing instance for edit mode, null for create */
  editingInstance?: EntityInstanceWithValues | null
  /** Callback after successful save */
  onSaved?: (instanceId: string) => void
}

/**
 * Dialog for creating/editing entity instances
 * Uses VarEditorFieldRow + ConstantInputAdapter for form fields
 */
export function EntityInstanceDialog({
  open,
  onOpenChange,
  entityDefinition,
  editingInstance = null,
  onSaved,
}: EntityInstanceDialogProps) {
  const isEditing = !!editingInstance
  const utils = api.useUtils()

  // Field values state: { fieldId: value }
  const [values, setValues] = useState<Record<string, any>>({})

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

  // Sort custom fields by position
  const sortedFields = useMemo(() => {
    return [...(entityDefinition.customFields || [])]
      .filter((f) => f.active !== false)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  }, [entityDefinition.customFields])

  // Initialize form values when dialog opens
  useEffect(() => {
    if (open) {
      let initValues: Record<string, any> = {}

      if (editingInstance?.values) {
        // Edit mode: populate from existing values
        for (const fv of editingInstance.values) {
          // Extract raw value from TypedFieldValue
          const rawValue = extractRawValue(fv.value)
          initValues[fv.fieldId] = rawValue
        }
      } else {
        // Create mode: use default values
        for (const field of sortedFields) {
          if (field.defaultValue) {
            initValues[field.id] = field.defaultValue
          }
        }
      }

      setValues(initValues)
      setInitial(initValues) // Set baseline for dirty checking
      setErrors({})
      setTouched(new Set())
    }
  }, [open, editingInstance, sortedFields, setInitial])

  // Create instance mutation
  const createInstance = api.entityInstance.create.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to create', description: error.message })
    },
  })

  // Save field values with Zustand store sync
  const { saveMultipleAsync, isPending: isSavingFields } = useSaveFieldValue({
    resourceType: 'entity',
    entityDefId: entityDefinition.id,
    modelType: 'entity',
  })

  // Combined pending state
  const isPending = createInstance.isPending || isSavingFields

  /**
   * Handle field value change
   */
  const handleFieldChange = (fieldId: string, value: any) => {
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

    for (const field of sortedFields) {
      if (field.required) {
        const value = values[field.id]
        if (value === undefined || value === null || value === '') {
          newErrors[field.id] = `${field.name} is required`
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

      if (isEditing && editingInstance) {
        // Edit mode: just update values
        instanceId = editingInstance.id
      } else {
        // Create mode: create instance first
        const created = await createInstance.mutateAsync({
          entityDefinitionId: entityDefinition.id,
        })
        instanceId = created.id
      }

      // Save all field values with Zustand store sync
      const valuesToSave = Object.entries(values)
        .filter(([_, value]) => value !== undefined && value !== null && value !== '')
        .map(([fieldId, value]) => {
          const field = sortedFields.find((f) => f.id === fieldId)
          return { fieldId, value, fieldType: field?.type }
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md" position="tc" {...guardProps}>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? `Edit ${entityDefinition.singular}` : `New ${entityDefinition.singular}`}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? `Update the ${entityDefinition.singular.toLowerCase()} details below.`
              : `Enter the details for the new ${entityDefinition.singular.toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>

        <VarEditorField className="p-0">
          {sortedFields.map((field) => (
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

        {sortedFields.length === 0 && (
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
            Cancel
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSubmit}
            loading={isPending}
            loadingText={isEditing ? 'Saving...' : 'Creating...'}
            disabled={sortedFields.length === 0}>
            {isEditing ? 'Save Changes' : `Create ${entityDefinition.singular}`}
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}

/**
 * Extract raw value from TypedFieldValue.
 * Values are now TypedFieldValue format (not legacy { data: x })
 * For relationships, preserves the full object with both relatedEntityId and relatedEntityDefinitionId.
 */
function extractRawValue(value: unknown): any {
  if (value === null || value === undefined) return null

  // Handle TypedFieldValue array (multi-select, tags, relationships)
  if (Array.isArray(value)) {
    return value.map((v: any) => {
      if (v && typeof v === 'object' && 'type' in v) {
        // For relationships, preserve the full object structure
        if (v.type === 'relationship') {
          return {
            relatedEntityId: v.relatedEntityId,
            relatedEntityDefinitionId: v.relatedEntityDefinitionId,
          }
        }
        return v.optionId ?? v.value
      }
      return v
    })
  }

  // Handle single TypedFieldValue
  if (typeof value === 'object' && 'type' in value) {
    const tv = value as {
      type: string
      value?: any
      optionId?: string
      relatedEntityId?: string
      relatedEntityDefinitionId?: string
    }

    // For relationships, preserve the full object structure
    if (tv.type === 'relationship') {
      return {
        relatedEntityId: tv.relatedEntityId,
        relatedEntityDefinitionId: tv.relatedEntityDefinitionId,
      }
    }

    return tv.optionId ?? tv.value
  }

  return value
}
