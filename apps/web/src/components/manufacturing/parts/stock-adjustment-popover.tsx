// apps/web/src/components/manufacturing/parts/stock-adjustment-popover.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
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

interface StockAdjustmentFormProps {
  /** The part's entityInstanceId */
  partId: string
  /** Current quantity on hand (needed for "Set to" mode) */
  currentQoH: number
  onSuccess?: () => void
  /** Dismiss whatever surface this form is mounted in. */
  onDone: () => void
}

/**
 * The form for a manual `adjust` movement, through `purchasing.adjustStock` only (never the
 * generic record write). It resets by unmounting; see `ReceiveStockForm` for why callers
 * guarantee that.
 *
 * No "Adjust subparts" control and no BOM cascade: a count correction has no direction of its
 * own to explode along (plans/products/11-costing-and-stock-improvements.md §5.3). No unit cost
 * input either: `G12` values the movement at the part's own standard, server-side, in both
 * directions. A part with no standard is not refused — the movement is written pending and
 * valued when the part gets a cost (111 Q18), which the note under the form says.
 */
export function StockAdjustmentForm({
  partId,
  currentQoH,
  onSuccess,
  onDone,
}: StockAdjustmentFormProps) {
  const [direction, setDirection] = useState<Direction>('add')
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('adjust_by')
  const [quantity, setQuantity] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')

  // Whether the movement will be valued now or once the part has a cost (111 Q18).
  const partDefId = useResourceProperty('part', 'id')
  const partRecordId = partDefId ? toRecordId(partDefId, partId) : null
  const standard = useSystemValues(partRecordId, ['part_standard_cost'], {
    autoFetch: true,
    enabled: !!partRecordId,
  })
  const pendingCost =
    !!partRecordId && !standard.isLoading && standard.values.part_standard_cost == null

  /**
   * The signed delta this form will send — one number, derived once, so the
   * "Set to" preview and the submit guard can never disagree about which
   * direction the adjustment goes.
   */
  const delta = useMemo(() => {
    const qty = quantity ?? 0
    if (quantityMode === 'set_to') return qty - currentQoH
    return direction === 'remove' ? -Math.abs(qty) : Math.abs(qty)
  }, [quantity, quantityMode, direction, currentQoH])

  const adjustStock = api.purchasing.adjustStock.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to adjust stock', description: error.message })
    },
  })

  const isPending = adjustStock.isPending

  // The one server guard duplicated here; `receipt-input.ts` says why a client check is never the only one.
  const canSubmit = delta !== 0

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    try {
      await adjustStock.mutateAsync({
        partId,
        quantity: delta,
        ...(reason ? { reason } : {}),
        ...(reference ? { reference } : {}),
      })
      onSuccess?.()
      onDone()
    } catch {
      // onError above already surfaced the toast.
    }
  }, [canSubmit, adjustStock, partId, delta, reason, reference, onSuccess, onDone])

  const isSetToMode = quantityMode === 'set_to'

  const directionFieldOptions = useMemo(() => ({ options: DIRECTION_OPTIONS }), [])
  const quantityModeFieldOptions = useMemo(() => ({ options: QUANTITY_MODE_OPTIONS }), [])

  return (
    <>
      <FieldPanel className='p-0' orientation='horizontal' defaultLabelWidth={112}>
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
              Delta: {delta >= 0 ? '+' : ''}
              {delta}
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

      {pendingCost && (
        <p className='text-muted-foreground text-xs'>Valued when this part gets a cost.</p>
      )}

      {/* Actions */}
      <div className='flex justify-end gap-2'>
        <Button variant='ghost' size='xs' onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button
          variant='outline'
          size='xs'
          onClick={handleSubmit}
          loading={isPending}
          loadingText='Saving...'
          disabled={!canSubmit}>
          Save
        </Button>
      </div>
    </>
  )
}

interface StockAdjustmentPopoverProps {
  /** The part's entityInstanceId */
  partId: string
  /** Current quantity on hand (needed for "Set to" mode) */
  currentQoH: number
  onSuccess?: () => void
  /** The trigger. */
  children: React.ReactNode
}

/**
 * The adjustment form in a popover of its own, for a surface with room for a
 * trigger. See `ReceiveStockPopover` for why a menu must not use this.
 */
export function StockAdjustmentPopover({
  partId,
  currentQoH,
  onSuccess,
  children,
}: StockAdjustmentPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className='w-96 p-3' align='end'>
        <div className='space-y-3'>
          <h4 className='text-sm font-semibold'>Adjust Stock</h4>
          <StockAdjustmentForm
            partId={partId}
            currentQoH={currentQoH}
            onSuccess={onSuccess}
            onDone={() => setOpen(false)}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
