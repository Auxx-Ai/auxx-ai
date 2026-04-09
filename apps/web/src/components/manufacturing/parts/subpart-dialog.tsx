// apps/web/src/components/manufacturing/parts/subpart-dialog.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { BaseType } from '~/components/workflow/types'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'

const SUBPART_SYSTEM_ATTRIBUTES = [
  'subpart_child_part',
  'subpart_quantity',
  'subpart_notes',
] as const

/** Props for SubpartDialog component */
interface SubpartDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** Parent part ID */
  parentPartId: string
  /** RecordId for edit mode */
  recordId?: RecordId
  /** Callback on successful save */
  onSuccess?: () => void
}

/** Dialog for adding/editing a subpart */
export function SubpartDialog({
  open,
  onOpenChange,
  parentPartId,
  recordId,
  onSuccess,
}: SubpartDialogProps) {
  const isEditMode = !!recordId

  // State
  const [values, setValues] = useState({
    childPartId: '',
    quantity: 1,
    notes: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Resolve entity definition IDs
  const subpartDefId = useResourceProperty('subpart', 'id')

  // Load initial values for edit mode
  const { values: systemValues } = useSystemValues(recordId, SUBPART_SYSTEM_ATTRIBUTES, {
    autoFetch: true,
    enabled: isEditMode && open,
  })

  // Fetch all parts for selection
  const { data: partsData, isLoading: isLoadingParts } = api.part.all.useQuery(
    {},
    { enabled: open }
  )
  const allParts = partsData?.parts ?? []

  // Fetch existing subparts via entity system to filter out already-added parts
  const existingSubpartFilters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'parent-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'parent-match',
            fieldId: 'subpart:parentPart' as ResourceFieldId,
            operator: 'is' as const,
            value: parentPartId,
          },
        ],
      },
    ],
    [parentPartId]
  )

  const { records: existingSubpartRecords } = useRecordList({
    entityDefinitionId: subpartDefId ?? '',
    filters: existingSubpartFilters,
    enabled: open && !!parentPartId && !!subpartDefId,
  })

  // BFS cycle detection: check all descendants of the selected child part
  const { data: descendants } = api.record.getDescendantRecordIds.useQuery(
    {
      recordId: toRecordId(subpartDefId ?? '', values.childPartId),
      resourceFieldId: 'subpart:childPart' as ResourceFieldId,
    },
    { enabled: open && !isEditMode && !!values.childPartId && !!subpartDefId }
  )

  // Build parent recordId for cycle check
  const parentRecordId = subpartDefId ? toRecordId(subpartDefId, parentPartId) : null

  const hasCyclicDependency =
    values.childPartId === parentPartId ||
    (parentRecordId != null && descendants?.includes(parentRecordId)) ||
    false

  // Build exclusion set for existing child parts
  const existingChildPartIds = useMemo(() => {
    return new Set(existingSubpartRecords.map((r: any) => r.id))
  }, [existingSubpartRecords])

  // Filter available parts
  const availableParts = useMemo(() => {
    if (isEditMode) return allParts
    return allParts.filter((part) => {
      if (part.id === parentPartId) return false
      if (existingChildPartIds.has(part.id)) return false
      return true
    })
  }, [allParts, isEditMode, parentPartId, existingChildPartIds])

  // Part options for ENUM
  const partOptions = useMemo(
    () => availableParts.map((p) => ({ label: `${p.title} - ${p.sku}`, value: p.id })),
    [availableParts]
  )

  // Initialize/reset values when dialog opens
  useEffect(() => {
    if (open) {
      if (isEditMode && systemValues) {
        setValues({
          childPartId: (systemValues.subpart_child_part as string) ?? '',
          quantity: (systemValues.subpart_quantity as number) ?? 1,
          notes: (systemValues.subpart_notes as string) ?? '',
        })
      } else if (!isEditMode) {
        setValues({
          childPartId: '',
          quantity: 1,
          notes: '',
        })
      }
      setErrors({})
    }
  }, [open, isEditMode, systemValues])

  // Field change handler
  const handleChange = useCallback((field: string, value: any) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      if (prev[field]) {
        const next = { ...prev }
        delete next[field]
        return next
      }
      return prev
    })
  }, [])

  // Validation
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!values.childPartId) newErrors.childPartId = 'Subpart is required'
    if (!values.quantity || values.quantity < 1) newErrors.quantity = 'Quantity must be at least 1'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Create mutation via entity system
  const createRecord = api.record.create.useMutation({
    onSuccess: () => {
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to add subpart', description: error.message })
    },
  })

  // Save field values for edit mode
  const { saveMultipleAsync, isPending: isSavingFields } = useSaveFieldValue({})

  const isPending = createRecord.isPending || isSavingFields
  const noAvailableParts = availableParts.length === 0 && !isLoadingParts && !isEditMode

  // Submit
  const handleSubmit = async () => {
    if (hasCyclicDependency) {
      toastError({ title: 'Cannot create a cyclic dependency between parts' })
      return
    }
    if (!validate()) return

    if (isEditMode && recordId) {
      // Edit mode: only quantity and notes are updatable
      const fieldValues: Array<{ fieldId: string; value: unknown; fieldType: string }> = [
        { fieldId: 'subpart_quantity', value: values.quantity, fieldType: 'NUMBER' },
        { fieldId: 'subpart_notes', value: values.notes || undefined, fieldType: 'TEXT' },
      ]

      const success = await saveMultipleAsync(recordId, fieldValues)
      if (success) {
        onSuccess?.()
        onOpenChange(false)
      }
    } else {
      // Create mode: use record.create with systemAttribute keys
      await createRecord.mutateAsync({
        entityDefinitionId: subpartDefId!,
        values: {
          subpart_parent_part: parentPartId,
          subpart_child_part: values.childPartId,
          subpart_quantity: values.quantity,
          subpart_notes: values.notes || undefined,
        },
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]' position='tc'>
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Subpart' : 'Add Subpart'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the subpart configuration'
              : 'Add a component that will be used in the assembly of this part'}
          </DialogDescription>
        </DialogHeader>

        <VarEditorField className='p-0'>
          {/* Subpart Selection */}
          <VarEditorFieldRow
            title='Subpart'
            description='Component to add'
            isRequired
            validationError={
              errors.childPartId || (noAvailableParts ? 'No available parts to add' : undefined)
            }
            validationType={noAvailableParts ? 'warning' : 'error'}>
            <ConstantInputAdapter
              value={values.childPartId}
              onChange={(_, val) => handleChange('childPartId', val)}
              varType={BaseType.ENUM}
              placeholder={isLoadingParts ? 'Loading...' : 'Select a component...'}
              disabled={isPending || isEditMode || isLoadingParts || noAvailableParts}
              fieldOptions={{ enum: partOptions }}
            />
          </VarEditorFieldRow>

          {/* Quantity */}
          <VarEditorFieldRow
            title='Quantity'
            description='Number of units required per parent part'
            type={BaseType.NUMBER}
            showIcon
            isRequired
            validationError={errors.quantity}
            validationType='error'>
            <ConstantInputAdapter
              value={values.quantity}
              onChange={(_, val) => handleChange('quantity', val ?? 1)}
              varType={BaseType.NUMBER}
              placeholder='1'
              disabled={isPending}
            />
          </VarEditorFieldRow>

          {/* Notes */}
          <VarEditorFieldRow
            title='Notes'
            description='Optional notes about this component usage'
            type={BaseType.STRING}
            showIcon>
            <ConstantInputAdapter
              value={values.notes}
              onChange={(_, val) => handleChange('notes', val ?? '')}
              varType={BaseType.STRING}
              placeholder='Optional notes...'
              disabled={isPending}
              fieldOptions={{ string: { multiline: true } }}
            />
          </VarEditorFieldRow>
        </VarEditorField>

        {/* Cyclic Dependency Warning */}
        {hasCyclicDependency && (
          <Alert variant='destructive'>
            <AlertCircle />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              Cyclic dependency detected: This would create a circular reference.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            size='sm'
            variant='outline'
            loading={isPending}
            loadingText={isEditMode ? 'Updating...' : 'Adding...'}
            disabled={noAvailableParts || hasCyclicDependency || !subpartDefId}
            data-dialog-submit>
            {isEditMode ? 'Update Subpart' : 'Add Subpart'}{' '}
            <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
