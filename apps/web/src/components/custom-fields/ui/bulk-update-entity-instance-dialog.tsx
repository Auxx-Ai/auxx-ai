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
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { FieldInputRow } from './field-input-row'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useDirtyCheck } from '~/hooks/use-dirty-state'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useResource } from '~/components/resources'
import { useCustomFieldValueSyncer } from '~/components/resources/hooks/use-custom-field-value-syncer'
import { formatToRawValue } from '@auxx/lib/field-values/client'

interface BulkUpdateEntityInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Entity definition ID */
  entityDefinitionId: string
  /** Array of selected entity instance IDs */
  selectedInstanceIds: string[]
  /** Callback after successful save */
  onSaved?: () => void
}

/**
 * Dialog for bulk updating entity instances.
 * Shows field values with <Varies> placeholder when values differ.
 * Only submits fields that were explicitly modified.
 */
export function BulkUpdateEntityInstanceDialog({
  open,
  onOpenChange,
  entityDefinitionId,
  selectedInstanceIds,
  onSaved,
}: BulkUpdateEntityInstanceDialogProps) {
  const instanceCount = selectedInstanceIds.length

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

  // Get values from store for all selected instances
  const { getValue } = useCustomFieldValueSyncer({
    resourceType: 'entity',
    entityDefId: entityDefinitionId,
    rowIds: selectedInstanceIds,
    customFieldColumnIds,
    columnVisibility: {},
    enabled: selectedInstanceIds.length > 0 && editableFields.length > 0,
  })

  // Field metadata provider for relationship sync
  const getFieldMetadata = useCallback(
    (fieldId: string) => {
      const field = editableFields.find((f) => f.id === fieldId)
      if (!field) return undefined
      return {
        type: field.fieldType ?? 'TEXT',
        relationship: field.options?.relationship as {
          isInverse?: boolean
          inverseFieldId?: string
          relationshipType?: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
          relatedEntityDefinitionId?: string
          relatedModelType?: string
        },
      }
    },
    [editableFields]
  )

  // Use hook for store-synced bulk updates
  const { saveBulkMultipleFields } = useSaveFieldValue({
    resourceType: 'entity',
    entityDefId: entityDefinitionId,
    modelType: 'entity',
    getFieldMetadata,
  })

  // Field values state: { fieldId: value }
  const [values, setValues] = useState<Record<string, unknown>>({})

  // Track initial values with varies state
  const [initialState, setInitialState] = useState<
    Record<string, { value: unknown; varies: boolean }>
  >({})

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

  // Compute initial values from store when dialog opens
  useEffect(() => {
    if (open && selectedInstanceIds.length > 0) {
      const computed: Record<string, { value: unknown; varies: boolean }> = {}

      for (const field of editableFields) {
        const fieldValues = selectedInstanceIds.map((id) => {
          const storeValue = getValue(id, field.id)
          return formatToRawValue(storeValue, field.fieldType ?? 'TEXT')
        })

        // Check if all values are the same
        const firstValue = fieldValues[0]
        const allSame = fieldValues.every((v) => JSON.stringify(v) === JSON.stringify(firstValue))

        computed[field.id] = {
          value: allSame ? firstValue : undefined,
          varies: !allSame,
        }
      }

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
  }, [open, selectedInstanceIds, editableFields, setInitial, getValue])

  /**
   * Handle field value change
   */
  const handleFieldChange = (fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }))
    setModifiedFields((prev) => new Set(prev).add(fieldId))
  }

  /**
   * Handle form submission.
   * Only submit fields that were explicitly modified.
   * Fire-and-forget: updates store optimistically, closes dialog immediately.
   */
  const handleSubmit = () => {
    // Build field values array with types
    const fieldValues = Array.from(modifiedFields)
      .map((fieldId) => {
        const field = editableFields.find((f) => f.id === fieldId)
        const value = values[fieldId]
        return { fieldId, value, fieldType: field?.fieldType }
      })
      .filter((fv) => fv.value !== undefined && fv.value !== null && fv.value !== '')

    if (fieldValues.length === 0) {
      onOpenChange(false)
      return
    }

    // Fire-and-forget: updates store optimistically, API call runs in background
    saveBulkMultipleFields(selectedInstanceIds, fieldValues)

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

  const resourceLabel = resource?.label ?? 'Record'
  const resourcePlural = resource?.plural ?? 'Records'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md" position="tc" {...guardProps}>
          <DialogHeader>
            <DialogTitle>
              Edit {instanceCount} {instanceCount === 1 ? resourceLabel : resourcePlural}
            </DialogTitle>
            <DialogDescription>
              Update field values for the selected{' '}
              {instanceCount === 1 ? resourceLabel.toLowerCase() : resourcePlural.toLowerCase()}.
              Fields showing &lt;Varies&gt; have different values across selections.
            </DialogDescription>
          </DialogHeader>

          <VarEditorField className="p-0">
            {editableFields.map((field) => {
              // Disable unique fields when editing multiple instances (would violate uniqueness)
              const isUniqueDisabled = field.isUnique && instanceCount > 1
              return (
                <FieldInputRow
                  key={field.id}
                  field={
                    isUniqueDisabled
                      ? { ...field, description: 'Unique fields cannot be bulk edited' }
                      : field
                  }
                  value={values[field.id] ?? ''}
                  onChange={handleFieldChange}
                  placeholder={getPlaceholder(field.id)}
                  disabled={isUniqueDisabled}
                />
              )
            })}
          </VarEditorField>

          {editableFields.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              No fields defined for this entity type.
            </div>
          )}

          <DialogFooter>
            <Button type="button" size="sm" variant="ghost" onClick={guardedClose}>
              Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSubmit}
              disabled={editableFields.length === 0 || modifiedFields.size === 0}>
              Update {instanceCount} {instanceCount === 1 ? resourceLabel : resourcePlural}{' '}
              <KbdSubmit variant="outline" size="sm" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
