// apps/web/src/components/manufacturing/parts/stock-adjustment-popover.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
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
 * The form for creating manual stock movements — `type: 'adjust'` only.
 *
 * 🛑 It resets by UNMOUNTING rather than by watching an `open` flag; see
 * `ReceiveStockForm` for why both callers guarantee that.
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
 * are deliberately untouched — only this control is gone. A movement that knows
 * its own direction may legitimately set the flag: consuming a finished good
 * does consume its components, and a negative movement makes the explosion
 * negate. It was only ever the arbitrary direction of an `adjust` that made the
 * cascade wrong. Do not remove the field.
 *
 * (The v9 inventory bridge used to be the in-tree example of that correct use.
 * It was deleted on 2026-08-27 —
 * plans/data-connectors/v9/inventory-bridge-disposition.md. The build path is
 * the surviving consumer: plans/products/build/01-build-plan.md.)
 *
 * 🛑 **This form calls `purchasing.adjustStock`, never the generic
 * `record.create`.** It used to write a `stock_movement` directly, which made it
 * a third movement writer that bypassed the zero-cost guard entirely: no
 * `unit_cost`, no `extended_cost`, no `gl_account`, no `cost_basis`. A positive
 * adjustment therefore added stock valued at nothing, which understates COGS and
 * drags the part's average cost toward zero
 * (plans/purchasing/05-receiving-cost-and-corrections.md §1.5).
 *
 * 🛑 **There is no Unit cost input, and there must not be one.** There used to
 * be, shown only when the adjustment ADDED stock, on the argument that adding
 * creates inventory value and somebody has to say what it is worth. Decision
 * `G12` settles that differently and in both directions: an adjustment is valued
 * at the part's own frozen `part_standard_cost`, read by the SERVER. A typed
 * number made the ledger's valuation depend on who happened to be counting, and
 * a removal that carried no cost at all was invisible to every period total that
 * sums the ledger — so the L1 month-end assertion absorbed shrinkage into the
 * COGS plug, which is exactly the separation `G12` exists to get.
 *
 * A part with NO standard cost is refused by `adjustStock`, naming the part and
 * saying to roll standard cost first. That refusal surfaces here as the error
 * toast; it is deliberately not duplicated as a disabled button, because this
 * form does not know the part's standard cost and a guess would be worse than
 * the server's sentence.
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

  /**
   * The friendly duplicate of the ONE server guard this form can honestly
   * duplicate, not the guard itself.
   *
   * `adjustStock` refuses a zero delta, and it refuses a part with no standard
   * cost. Only the first is knowable here — the browser does not read
   * `part_standard_cost` — so the second arrives as an error toast naming the
   * part, which is a better answer than a button disabled for a reason the form
   * would have to guess at. `receipt-input.ts` states the same rule about a
   * client check never being the only one.
   */
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

        {/* No cost input. See the note on this component: `G12` values an
                adjustment at the part's own frozen standard cost, server-side,
                in both directions. */}

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
