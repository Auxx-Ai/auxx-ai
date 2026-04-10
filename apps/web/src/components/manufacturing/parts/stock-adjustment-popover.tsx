// apps/web/src/components/manufacturing/parts/stock-adjustment-popover.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toRecordId, useResourceProperty } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'

type Direction = 'add' | 'remove'
type QuantityMode = 'adjust_by' | 'set_to'

const DIRECTION_OPTIONS = [
  { label: 'Add stock', value: 'add' },
  { label: 'Remove stock', value: 'remove' },
]

const QUANTITY_MODE_OPTIONS = [
  { label: 'Adjust by', value: 'adjust_by' },
  { label: 'Set to', value: 'set_to' },
]

interface StockAdjustmentPopoverProps {
  /** The part's entityInstanceId */
  partId: string
  /** Current quantity on hand (needed for "Set to" mode) */
  currentQoH: number
  onSuccess?: () => void
  children: React.ReactNode
}

/** Popover for creating manual stock movements */
export function StockAdjustmentPopover({
  partId,
  currentQoH,
  onSuccess,
  children,
}: StockAdjustmentPopoverProps) {
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<Direction>('add')
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('adjust_by')
  const [quantity, setQuantity] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')

  const stockMovementDefId = useResourceProperty('stock_movement', 'id')
  const partDefId = useResourceProperty('part', 'id')

  // Reset form when popover opens
  useEffect(() => {
    if (open) {
      setDirection('add')
      setQuantityMode('adjust_by')
      setQuantity(null)
      setReason('')
      setReference('')
    }
  }, [open])

  const createRecord = api.record.create.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to adjust stock', description: error.message })
    },
  })

  const handleSubmit = useCallback(async () => {
    if (!stockMovementDefId || !partDefId) return
    const qty = quantity ?? 0
    if (qty === 0 && quantityMode === 'adjust_by') return

    let finalQuantity: number

    if (quantityMode === 'set_to') {
      finalQuantity = qty - currentQoH
    } else {
      finalQuantity = direction === 'remove' ? -Math.abs(qty) : Math.abs(qty)
    }

    await createRecord.mutateAsync({
      entityDefinitionId: stockMovementDefId,
      values: {
        stock_movement_part: toRecordId(partDefId, partId),
        stock_movement_type: 'adjust',
        stock_movement_quantity: finalQuantity,
        ...(reason && { stock_movement_reason: reason }),
        ...(reference && { stock_movement_reference: reference }),
      },
    })

    onSuccess?.()
    setOpen(false)
  }, [
    stockMovementDefId,
    partDefId,
    partId,
    quantity,
    quantityMode,
    direction,
    currentQoH,
    reason,
    reference,
    createRecord,
    onSuccess,
  ])

  const isSetToMode = quantityMode === 'set_to'
  const isPending = createRecord.isPending

  const directionFieldOptions = useMemo(() => ({ enum: DIRECTION_OPTIONS }), [])
  const quantityModeFieldOptions = useMemo(() => ({ enum: QUANTITY_MODE_OPTIONS }), [])
  const quantityFieldOptions = useMemo(() => ({ number: { min: 0 } }), [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className='w-96' align='end'>
        <div className='space-y-3'>
          <h4 className='text-sm font-semibold'>Adjust Stock</h4>

          <VarEditorField className='p-0'>
            {/* Mode */}
            <VarEditorFieldRow title='Mode' type={BaseType.ENUM} showIcon isRequired>
              <ConstantInputAdapter
                value={quantityMode}
                onChange={(_, val) => setQuantityMode((val as QuantityMode) ?? 'adjust_by')}
                varType={BaseType.ENUM}
                fieldOptions={quantityModeFieldOptions}
                disabled={isPending}
              />
            </VarEditorFieldRow>

            {/* Direction */}
            {!isSetToMode && (
              <VarEditorFieldRow title='Direction' type={BaseType.ENUM} showIcon isRequired>
                <ConstantInputAdapter
                  value={direction}
                  onChange={(_, val) => setDirection((val as Direction) ?? 'add')}
                  varType={BaseType.ENUM}
                  fieldOptions={directionFieldOptions}
                  disabled={isPending}
                />
              </VarEditorFieldRow>
            )}

            {/* Quantity */}
            <VarEditorFieldRow title='Quantity' type={BaseType.NUMBER} showIcon isRequired>
              <ConstantInputAdapter
                value={quantity}
                onChange={(_, val) => setQuantity(val ?? null)}
                varType={BaseType.NUMBER}
                placeholder={isSetToMode ? String(currentQoH) : '0'}
                disabled={isPending}
                fieldOptions={quantityFieldOptions}
              />
              {isSetToMode && quantity !== null && (
                <p className='text-xs text-muted-foreground mt-1'>
                  Delta: {quantity - currentQoH >= 0 ? '+' : ''}
                  {quantity - currentQoH}
                </p>
              )}
            </VarEditorFieldRow>

            {/* Reason */}
            <VarEditorFieldRow title='Reason' type={BaseType.STRING} showIcon>
              <ConstantInputAdapter
                value={reason}
                onChange={(_, val) => setReason(val ?? '')}
                varType={BaseType.STRING}
                placeholder='e.g. Recount, Damaged goods'
                disabled={isPending}
              />
            </VarEditorFieldRow>

            {/* Reference */}
            <VarEditorFieldRow title='Reference' type={BaseType.STRING} showIcon>
              <ConstantInputAdapter
                value={reference}
                onChange={(_, val) => setReference(val ?? '')}
                varType={BaseType.STRING}
                placeholder='e.g. PO-1234, RMA-567'
                disabled={isPending}
              />
            </VarEditorFieldRow>
          </VarEditorField>

          {/* Actions */}
          <div className='flex justify-end gap-2'>
            <Button variant='ghost' size='xs' onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant='outline'
              size='xs'
              onClick={handleSubmit}
              loading={isPending}
              loadingText='Saving...'>
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
