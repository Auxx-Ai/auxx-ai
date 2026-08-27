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
  onSuccess?: () => void
  children: React.ReactNode
}

/**
 * Popover for creating manual stock movements — `type: 'adjust'` only.
 *
 * 🛑 There is deliberately no "Adjust subparts" control and no BOM cascade.
 * The toggle that used to live here exploded the bill of materials WITHOUT
 * negating, so "Add 10" of a finished good increased every component's stock
 * as well — the assembly and the parts it consumed both went up, which is the
 * opposite of what building one does
 * (plans/products/11-costing-and-stock-improvements.md §5.3).
 *
 * An adjustment is a count correction and must never cascade: explosion belongs
 * to a movement that knows its own direction.
 *
 * ⚠️ The `stock_movement_adjust_subparts` FIELD and the BOM explosion behind it
 * are deliberately untouched — only this control is gone. The inventory bridge
 * still sets the flag on `sale` movements
 * (`data-connectors/inventory-bridge-pass.ts`), and that use is CORRECT: selling
 * a finished good does consume its components, and a sale is negative, so the
 * explosion negates. It was only ever the arbitrary direction of an `adjust`
 * that made the cascade wrong. Do not remove the field.
 */
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
                onChange={(val) =>
                  setQuantityMode(((val as string[])[0] as QuantityMode) ?? 'adjust_by')
                }
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
          </FieldPanel>

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
