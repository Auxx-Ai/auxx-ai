// apps/web/src/components/manufacturing/parts/stock-adjustment-popover.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useResourceProperty } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'
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
  /** Whether this part has subparts (BOM) — enables "Adjust subparts" toggle */
  hasSubparts?: boolean
  onSuccess?: () => void
  children: React.ReactNode
}

/** Popover for creating manual stock movements */
export function StockAdjustmentPopover({
  partId,
  currentQoH,
  hasSubparts = false,
  onSuccess,
  children,
}: StockAdjustmentPopoverProps) {
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<Direction>('add')
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('adjust_by')
  const [quantity, setQuantity] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [adjustSubparts, setAdjustSubparts] = useState(false)

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
      setAdjustSubparts(false)
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
        ...(adjustSubparts && { stock_movement_adjust_subparts: true }),
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
    adjustSubparts,
    reason,
    reference,
    createRecord,
    onSuccess,
  ])

  const isSetToMode = quantityMode === 'set_to'
  const isPending = createRecord.isPending

  const directionFieldOptions = useMemo(() => ({ options: DIRECTION_OPTIONS }), [])
  const quantityModeFieldOptions = useMemo(() => ({ options: QUANTITY_MODE_OPTIONS }), [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className='w-96' align='end'>
        <div className='space-y-3'>
          <h4 className='text-sm font-semibold'>Adjust Stock</h4>

          <FieldPanel className='p-0'>
            {/* Mode */}
            <FieldPanelRow
              title='Mode'
              type={BaseType.ENUM}
              showIcon
              isRequired
              description='Adjust by a relative amount or set to an absolute quantity'>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                value={quantityMode}
                onChange={(val) => {
                  const mode = ((val as string[])[0] as QuantityMode) ?? 'adjust_by'
                  setQuantityMode(mode)
                  if (mode === 'set_to') setAdjustSubparts(false)
                }}
                fieldOptions={quantityModeFieldOptions}
                disabled={isPending}
              />
            </FieldPanelRow>

            {/* Direction */}
            {!isSetToMode && (
              <FieldPanelRow
                title='Direction'
                type={BaseType.ENUM}
                showIcon
                isRequired
                description='Whether to add or remove stock'>
                <FieldInputAdapter
                  fieldType={FieldType.SINGLE_SELECT}
                  value={direction}
                  onChange={(val) => setDirection(((val as string[])[0] as Direction) ?? 'add')}
                  fieldOptions={directionFieldOptions}
                  disabled={isPending}
                />
              </FieldPanelRow>
            )}

            {/* Quantity */}
            <FieldPanelRow title='Quantity' type={BaseType.NUMBER} showIcon isRequired>
              <FieldInputAdapter
                fieldType={FieldType.NUMBER}
                value={quantity}
                onChange={(val) => setQuantity((val as number) ?? null)}
                placeholder={isSetToMode ? String(currentQoH) : '0'}
                disabled={isPending}
              />
              {isSetToMode && quantity !== null && (
                <p className='text-xs text-muted-foreground mt-1'>
                  Delta: {quantity - currentQoH >= 0 ? '+' : ''}
                  {quantity - currentQoH}
                </p>
              )}
            </FieldPanelRow>

            {/* Reason */}
            <FieldPanelRow title='Reason' type={BaseType.STRING} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={reason}
                onChange={(val) => setReason((val as string) ?? '')}
                placeholder='e.g. Recount, Damaged goods'
                disabled={isPending}
              />
            </FieldPanelRow>

            {/* Reference */}
            <FieldPanelRow title='Reference' type={BaseType.STRING} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={reference}
                onChange={(val) => setReference((val as string) ?? '')}
                placeholder='e.g. PO-1234, RMA-567'
                disabled={isPending}
              />
            </FieldPanelRow>

            {/* Adjust subparts toggle — only shown when part has subparts and in "Adjust by" mode */}
            {hasSubparts && !isSetToMode && (
              <FieldPanelRow
                title='Adjust subparts'
                type={BaseType.BOOLEAN}
                showIcon
                description='Cascade this adjustment to all leaf component parts based on the bill of materials'>
                <FieldInputAdapter
                  fieldType={FieldType.CHECKBOX}
                  value={adjustSubparts}
                  onChange={(val) => setAdjustSubparts((val as boolean) ?? false)}
                  fieldOptions={{ variant: 'switch' }}
                  disabled={isPending}
                />
              </FieldPanelRow>
            )}
          </FieldPanel>

          {/* Info hint when adjust subparts is enabled */}
          {adjustSubparts && (
            <p className='text-xs text-muted-foreground'>
              Adjustment will be applied to all component parts based on the bill of materials.
            </p>
          )}

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
