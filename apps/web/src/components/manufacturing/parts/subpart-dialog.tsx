// apps/web/src/components/manufacturing/parts/subpart-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { getInstanceId, isRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
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
import { generateId } from '@auxx/utils/generateId'
import { Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

/** Synthetic relationship config for the ad-hoc "child part" picker (not backed by a real field) */
const CHILD_PART_RELATIONSHIP: RelationshipConfig = {
  inverseResourceFieldId: toResourceFieldId('part', 'id'),
  relationshipType: 'belongs_to',
  isInverse: false,
}

const SUBPART_SYSTEM_ATTRIBUTES = [
  'subpart_child_part',
  'subpart_quantity',
  'subpart_notes',
] as const

/** One editable subpart row in create mode */
interface SubpartRow {
  key: string
  childPartId: string
  quantity: number
  notes: string
}

const emptyRow = (): SubpartRow => ({
  key: generateId(),
  childPartId: '',
  quantity: 1,
  notes: '',
})

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

/** Dialog for adding one or many subparts (create), or editing a single subpart */
export function SubpartDialog({
  open,
  onOpenChange,
  parentPartId,
  recordId,
  onSuccess,
}: SubpartDialogProps) {
  const isEditMode = !!recordId

  // Create mode: a list of rows. Edit mode: a single value set.
  const [rows, setRows] = useState<SubpartRow[]>([emptyRow()])
  const [editValues, setEditValues] = useState({ quantity: 1, notes: '' })
  // Errors keyed by `${rowKey}.childPartId` / `${rowKey}.quantity` (create) or `edit.quantity` (edit)
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

  // Base exclusion set: parent part + descendants + already-added child parts.
  // Per-row exclusion additionally removes child parts picked in the other rows.
  const baseExcludedPartIds = useMemo(() => {
    const ids: RecordId[] = [toRecordId(partDefId ?? 'part', parentPartId)]

    // Add descendant RecordIds (prevents cycles)
    if (descendants) {
      ids.push(...descendants)
    }

    // Add existing child part RecordIds (prevents duplicates)
    for (const record of existingSubpartRecords) {
      const childVal = (record as any).fieldValues?.subpart_child_part
      if (childVal && isRecordId(childVal)) {
        ids.push(childVal)
      }
    }

    return [...new Set(ids)]
  }, [parentPartId, partDefId, descendants, existingSubpartRecords])

  /** Exclusion set for a single row: base + child parts chosen in the other rows */
  const excludedForRow = useCallback(
    (rowKey: string): RecordId[] => {
      const others = rows
        .filter((r) => r.key !== rowKey && r.childPartId)
        .map((r) => toRecordId(partDefId ?? 'part', r.childPartId))
      return [...new Set([...baseExcludedPartIds, ...others])]
    },
    [rows, partDefId, baseExcludedPartIds]
  )

  // Initialize/reset when dialog opens
  useEffect(() => {
    if (!open) return
    if (isEditMode && systemValues) {
      // Edit only mutates quantity/notes; the child part is fixed.
      setEditValues({
        quantity: (systemValues.subpart_quantity as number) ?? 1,
        notes: (systemValues.subpart_notes as string) ?? '',
      })
    } else if (!isEditMode) {
      setRows([emptyRow()])
    }
    setErrors({})
  }, [open, isEditMode, systemValues])

  // Row mutators (create mode)
  const updateRow = useCallback((key: string, field: keyof SubpartRow, value: unknown) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
    setErrors((prev) => {
      const errKey = `${key}.${field}`
      if (prev[errKey]) {
        const next = { ...prev }
        delete next[errKey]
        return next
      }
      return prev
    })
  }, [])

  const addRow = useCallback(() => setRows((prev) => [...prev, emptyRow()]), [])

  const removeRow = useCallback(
    (key: string) =>
      setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev)),
    []
  )

  const handleEditChange = useCallback((field: 'quantity' | 'notes', value: unknown) => {
    setEditValues((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      if (prev[`edit.${field}`]) {
        const next = { ...prev }
        delete next[`edit.${field}`]
        return next
      }
      return prev
    })
  }, [])

  // Validation
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (isEditMode) {
      if (!editValues.quantity || editValues.quantity < 1)
        newErrors['edit.quantity'] = 'Quantity must be at least 1'
    } else {
      for (const row of rows) {
        if (!row.childPartId) newErrors[`${row.key}.childPartId`] = 'Subpart is required'
        if (!row.quantity || row.quantity < 1)
          newErrors[`${row.key}.quantity`] = 'Quantity must be at least 1'
      }
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Create mutation via entity system (does not auto-close — we close after all rows succeed)
  const createRecord = api.record.create.useMutation({
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
        { fieldId: 'subpart_quantity', value: editValues.quantity, fieldType: 'NUMBER' },
        { fieldId: 'subpart_notes', value: editValues.notes || undefined, fieldType: 'TEXT' },
      ]

      const success = await saveMultipleAsync(recordId, fieldValues)
      if (success) {
        onSuccess?.()
        onOpenChange(false)
      }
      return
    }

    // Create mode: create one subpart record per row
    try {
      await Promise.all(
        rows.map((row) =>
          createRecord.mutateAsync({
            entityDefinitionId: subpartDefId!,
            values: {
              subpart_parent_part: toRecordId(partDefId!, parentPartId),
              subpart_child_part: toRecordId(partDefId!, row.childPartId),
              subpart_quantity: row.quantity,
              subpart_notes: row.notes || undefined,
            },
          })
        )
      )
      onSuccess?.()
      onOpenChange(false)
    } catch {
      // Per-row errors surfaced via the mutation's onError toast; keep dialog open.
    }
  }

  const submitLabel = isEditMode
    ? 'Update Subpart'
    : rows.length > 1
      ? `Add ${rows.length} Subparts`
      : 'Add Subpart'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px]' position='tc'>
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Subpart' : 'Add Subparts'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the subpart configuration'
              : 'Add one or more components used in the assembly of this part'}
          </DialogDescription>
        </DialogHeader>

        {isEditMode ? (
          <FieldPanel className='p-0' breakpoint='md' resizeId='subpart'>
            <FieldPanelRow
              title='Quantity'
              description='Number of units required per parent part'
              type={BaseType.NUMBER}
              showIcon
              isRequired
              validationError={errors['edit.quantity']}
              validationType='error'>
              <FieldInputAdapter
                fieldType={FieldType.NUMBER}
                value={editValues.quantity}
                onChange={(val) => handleEditChange('quantity', val ?? 1)}
                placeholder='1'
                disabled={isPending}
              />
            </FieldPanelRow>

            <FieldPanelRow
              title='Notes'
              description='Optional notes about this component usage'
              type={BaseType.STRING}
              showIcon>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={editValues.notes}
                onChange={(val) => handleEditChange('notes', val ?? '')}
                placeholder='Optional notes...'
                disabled={isPending}
                fieldOptions={{ multiline: true }}
              />
            </FieldPanelRow>
          </FieldPanel>
        ) : (
          <div className='flex flex-col gap-3 max-h-[55vh] overflow-y-auto pe-1'>
            {rows.map((row, index) => (
              <div
                key={row.key}
                className='relative rounded-lg border border-border/60 bg-muted/20 p-3'>
                {rows.length > 1 && (
                  <div className='mb-2 flex items-center justify-between'>
                    <span className='text-xs font-medium text-muted-foreground'>
                      Component {index + 1}
                    </span>
                    <Button
                      type='button'
                      variant='ghost'
                      size='xs'
                      onClick={() => removeRow(row.key)}
                      disabled={isPending}
                      aria-label='Remove component'>
                      <X />
                    </Button>
                  </div>
                )}

                <FieldPanel className='p-0' breakpoint='md' resizeId='subpart'>
                  <FieldPanelRow
                    title='Subpart'
                    description='Component to add'
                    isRequired
                    validationError={errors[`${row.key}.childPartId`]}>
                    <FieldInputAdapter
                      fieldType={FieldType.RELATIONSHIP}
                      value={
                        row.childPartId && partDefId ? [toRecordId(partDefId, row.childPartId)] : []
                      }
                      onChange={(value) => {
                        const recordIds = value as RecordId[]
                        const first = recordIds[0]
                        updateRow(row.key, 'childPartId', first ? getInstanceId(first) : '')
                      }}
                      placeholder='Select a component...'
                      disabled={isPending}
                      fieldOptions={{
                        relationship: CHILD_PART_RELATIONSHIP,
                        excludeIds: excludedForRow(row.key),
                      }}
                    />
                  </FieldPanelRow>

                  <FieldPanelRow
                    title='Quantity'
                    description='Units required per parent part'
                    type={BaseType.NUMBER}
                    showIcon
                    isRequired
                    validationError={errors[`${row.key}.quantity`]}
                    validationType='error'>
                    <FieldInputAdapter
                      fieldType={FieldType.NUMBER}
                      value={row.quantity}
                      onChange={(val) => updateRow(row.key, 'quantity', val ?? 1)}
                      placeholder='1'
                      disabled={isPending}
                    />
                  </FieldPanelRow>

                  <FieldPanelRow
                    title='Notes'
                    description='Optional notes about this component usage'
                    type={BaseType.STRING}
                    showIcon>
                    <FieldInputAdapter
                      fieldType={FieldType.TEXT}
                      value={row.notes}
                      onChange={(val) => updateRow(row.key, 'notes', val ?? '')}
                      placeholder='Optional notes...'
                      disabled={isPending}
                      fieldOptions={{ multiline: true }}
                    />
                  </FieldPanelRow>
                </FieldPanel>
              </div>
            ))}

            <div>
              <Button type='button' variant='ghost' size='sm' onClick={addRow} disabled={isPending}>
                <Plus />
                Add another
              </Button>
            </div>
          </div>
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
            disabled={!subpartDefId || !partDefId}
            data-dialog-submit>
            {submitLabel} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
