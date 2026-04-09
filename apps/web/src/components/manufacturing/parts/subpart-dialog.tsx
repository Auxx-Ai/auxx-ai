// apps/web/src/components/manufacturing/parts/subpart-dialog.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { getInstanceId, isRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
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
  const partDefId = useResourceProperty('part', 'id')

  // Load initial values for edit mode
  const { values: systemValues } = useSystemValues(recordId, SUBPART_SYSTEM_ATTRIBUTES, {
    autoFetch: true,
    enabled: isEditMode && open,
  })

  // Fetch existing subparts via entity system to get already-added child part IDs
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

  // BFS cycle detection: get all descendants to build exclusion set
  const { data: descendants } = api.record.getDescendantRecordIds.useQuery(
    {
      recordId: toRecordId('part', parentPartId),
      resourceFieldId: 'subpart:childPart' as ResourceFieldId,
    },
    { enabled: open && !isEditMode && !!subpartDefId }
  )

  // Build exclusion set: parent part + descendants + already-added child parts
  const excludedPartIds = useMemo(() => {
    const ids: string[] = [parentPartId]

    // Add descendant instance IDs (prevents cycles)
    if (descendants) {
      for (const rid of descendants) {
        ids.push(getInstanceId(rid))
      }
    }

    // Add existing child part IDs (prevents duplicates)
    for (const record of existingSubpartRecords) {
      // record.systemValues may contain the child part reference
      const childVal = (record as any).fieldValues?.subpart_child_part
      if (childVal && isRecordId(childVal)) {
        ids.push(getInstanceId(childVal))
      }
    }

    return [...new Set(ids)]
  }, [parentPartId, descendants, existingSubpartRecords])

  // Initialize/reset values when dialog opens
  useEffect(() => {
    if (open) {
      if (isEditMode && systemValues) {
        // Relationship fields return RecordId[] — unwrap array and extract instance ID
        const childPartRaw = systemValues.subpart_child_part
        const firstValue = Array.isArray(childPartRaw) ? childPartRaw[0] : childPartRaw
        const childPartId =
          typeof firstValue === 'string' && isRecordId(firstValue)
            ? getInstanceId(firstValue)
            : ((firstValue as string) ?? '')
        setValues({
          childPartId,
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

  // Handle childPartId change — extract instance ID from RecordId if needed
  const handleChildPartChange = useCallback(
    (_: string, value: any) => {
      const rawValue = typeof value === 'string' ? value : ''
      const instanceId = isRecordId(rawValue) ? getInstanceId(rawValue) : rawValue
      handleChange('childPartId', instanceId)
    },
    [handleChange]
  )

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

  // Submit
  const handleSubmit = async () => {
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
      // Relationship fields require RecordId format (entityDefId:instanceId)
      await createRecord.mutateAsync({
        entityDefinitionId: subpartDefId!,
        values: {
          subpart_parent_part: toRecordId(partDefId!, parentPartId),
          subpart_child_part: toRecordId(partDefId!, values.childPartId),
          subpart_quantity: values.quantity,
          subpart_notes: values.notes || undefined,
        },
      })
    }
  }

  // Build the RecordId value for the RelationInput (it expects RecordId format)
  const childPartRecordId =
    values.childPartId && partDefId ? toRecordId(partDefId, values.childPartId) : ''

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
            validationError={errors.childPartId}>
            <ConstantInputAdapter
              value={childPartRecordId}
              onChange={handleChildPartChange}
              varType={BaseType.RELATION}
              placeholder='Select a component...'
              disabled={isPending || isEditMode}
              fieldOptions={{
                relatedEntityDefinitionId: 'part',
                relationshipType: 'belongs_to',
                excludeIds: isEditMode ? undefined : excludedPartIds,
              }}
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
            disabled={!subpartDefId || !partDefId}
            data-dialog-submit>
            {isEditMode ? 'Update Subpart' : 'Add Subpart'}{' '}
            <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
