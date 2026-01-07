// apps/web/src/components/custom-fields/ui/bulk-update-entity-instance-dialog.tsx
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
  isUnique?: boolean | null
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
 * Entity row with custom field values
 */
interface EntityRow {
  id: string
  entityDefinitionId: string
  customFieldValues: Array<{
    fieldId: string
    value: unknown
  }>
}

interface BulkUpdateEntityInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Array of selected entity instances */
  selectedInstances: EntityRow[]
  /** Entity definition (required) */
  entityDefinition: EntityDefinitionWithFields
  /** Callback after successful save */
  onSaved?: () => void
}

/**
 * Extract raw value from TypedFieldValue.
 * Values are now TypedFieldValue format (not legacy { data: x })
 */
function extractRawValue(value: unknown): unknown {
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

/**
 * Compute initial values based on selected instances
 * If all instances have the same value for a field, use that value
 * Otherwise, mark the field as "varies"
 */
function computeInitialValues(
  instances: EntityRow[],
  fields: CustomFieldDef[]
): Record<string, { value: unknown; varies: boolean }> {
  const result: Record<string, { value: unknown; varies: boolean }> = {}

  for (const field of fields) {
    const values = instances.map((instance) => {
      const fieldValue = instance.customFieldValues?.find((v) => v.fieldId === field.id)
      return extractRawValue(fieldValue?.value)
    })

    // Check if all values are the same
    const firstValue = values[0]
    const allSame = values.every((v) => JSON.stringify(v) === JSON.stringify(firstValue))

    result[field.id] = {
      value: allSame ? firstValue : undefined,
      varies: !allSame,
    }
  }

  return result
}

/**
 * Dialog for bulk updating entity instances
 * Shows field values with <Varies> placeholder when values differ
 * Only submits fields that were explicitly modified
 */
export function BulkUpdateEntityInstanceDialog({
  open,
  onOpenChange,
  selectedInstances,
  entityDefinition,
  onSaved,
}: BulkUpdateEntityInstanceDialogProps) {
  const instanceCount = selectedInstances.length

  // Use hook for store-synced bulk updates
  const { saveBulkMultipleFields } = useSaveFieldValue({
    resourceType: 'entity',
    entityDefId: entityDefinition.id,
    modelType: 'entity',
  })

  // Field values state: { fieldId: value }
  const [values, setValues] = useState<Record<string, unknown>>({})

  // Track initial values with varies state
  const [initialState, setInitialState] = useState<Record<string, { value: unknown; varies: boolean }>>({})

  // Track which fields have been modified by the user
  const [modifiedFields, setModifiedFields] = useState<Set<string>>(new Set())

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
    if (open && selectedInstances.length > 0) {
      const computed = computeInitialValues(selectedInstances, sortedFields)
      setInitialState(computed)

      // Set initial values (undefined for varying fields)
      const initValues: Record<string, unknown> = {}
      for (const [fieldId, state] of Object.entries(computed)) {
        initValues[fieldId] = state.value
      }

      setValues(initValues)
      setInitial(initValues)
      setModifiedFields(new Set())
    }
  }, [open, selectedInstances, sortedFields, setInitial])

  /**
   * Handle field value change
   */
  const handleFieldChange = (fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }))
    setModifiedFields((prev) => new Set(prev).add(fieldId))
  }

  /**
   * Handle form submission
   * Only submit fields that were explicitly modified
   * Fire-and-forget: updates store optimistically, closes dialog immediately
   */
  const handleSubmit = () => {
    const resourceIds = selectedInstances.map((i) => i.id)

    // Build field values array with types
    const fieldValues = Array.from(modifiedFields)
      .map((fieldId) => {
        const field = sortedFields.find((f) => f.id === fieldId)
        const value = values[fieldId]
        return { fieldId, value, fieldType: field?.type }
      })
      .filter((fv) => fv.value !== undefined && fv.value !== null && fv.value !== '')

    if (fieldValues.length === 0) {
      onOpenChange(false)
      return
    }

    // Fire-and-forget: updates store optimistically, API call runs in background
    saveBulkMultipleFields(resourceIds, fieldValues)

    onSaved?.()
    onOpenChange(false)
  }

  /**
   * Get placeholder for a field based on its varies state
   */
  const getPlaceholder = (fieldId: string): string | undefined => {
    const state = initialState[fieldId]
    if (state?.varies && !modifiedFields.has(fieldId)) {
      return '<Varies>'
    }
    return undefined
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md" position="tc" {...guardProps}>
          <DialogHeader>
            <DialogTitle>
              Edit {instanceCount} {instanceCount === 1 ? entityDefinition.singular : entityDefinition.plural}
            </DialogTitle>
            <DialogDescription>
              Update field values for the selected {instanceCount === 1 ? entityDefinition.singular.toLowerCase() : entityDefinition.plural.toLowerCase()}.
              Fields showing &lt;Varies&gt; have different values across selections.
            </DialogDescription>
          </DialogHeader>

          <VarEditorField className="p-0">
            {sortedFields.map((field) => {
              // Disable unique fields when editing multiple instances (would violate uniqueness)
              const isUniqueDisabled = field.isUnique && instanceCount > 1
              return (
                <FieldInputRow
                  key={field.id}
                  field={isUniqueDisabled
                    ? { ...field, description: 'Unique fields cannot be bulk edited' }
                    : field}
                  value={values[field.id] ?? ''}
                  onChange={handleFieldChange}
                  placeholder={getPlaceholder(field.id)}
                  disabled={isUniqueDisabled}
                />
              )
            })}
          </VarEditorField>

          {sortedFields.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              No fields defined for this entity type.
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={guardedClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSubmit}
              disabled={sortedFields.length === 0 || modifiedFields.size === 0}>
              Update {instanceCount} {instanceCount === 1 ? entityDefinition.singular : entityDefinition.plural}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
