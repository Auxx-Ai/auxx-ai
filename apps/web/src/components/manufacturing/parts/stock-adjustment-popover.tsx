// apps/web/src/components/manufacturing/parts/stock-adjustment-popover.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
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
 *
 * 🛑 **This form calls `purchasing.adjustStock`, never the generic
 * `record.create`.** It used to write a `stock_movement` directly, which made it
 * a third movement writer that bypassed the zero-cost guard entirely: no
 * `unit_cost`, no `extended_cost`, no `gl_account`, no `cost_basis`. A positive
 * adjustment therefore added stock valued at nothing, which understates COGS and
 * drags the part's average cost toward zero
 * (plans/purchasing/05-receiving-cost-and-corrections.md §1.5).
 *
 * That is why the Unit cost input below appears only when the adjustment ADDS
 * stock. Adding creates inventory value and something has to say what it is
 * worth; removing consumes value the ledger already carries, and valuing a
 * removal properly needs a costing method this system does not have yet. So a
 * removal is exactly as unencumbered as it has always been.
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
  const [unitCost, setUnitCost] = useState<number | null>(null)
  // Whether the cost shown is the person's own number rather than the prefill.
  // Without this, the prefill effect would quietly overwrite a typed cost once
  // the query resolved.
  const [costEdited, setCostEdited] = useState(false)
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  // Reset form when popover opens
  useEffect(() => {
    if (open) {
      setDirection('add')
      setQuantityMode('adjust_by')
      setQuantity(null)
      setUnitCost(null)
      setCostEdited(false)
      setReason('')
      setReference('')
    }
  }, [open])

  /**
   * The signed delta this form will send — the one number both the cost input's
   * visibility and the submit guard are derived from, so they can never disagree
   * about which direction the adjustment goes.
   */
  const delta = useMemo(() => {
    const qty = quantity ?? 0
    if (quantityMode === 'set_to') return qty - currentQoH
    return direction === 'remove' ? -Math.abs(qty) : Math.abs(qty)
  }, [quantity, quantityMode, direction, currentQoH])

  const isAdding = delta > 0

  // What we last actually paid for this part — the honest default for "what are
  // the added units worth". Absent history simply leaves the field empty; it is
  // a prefill and never a floor.
  const lastCost = api.purchasing.lastReceiptCost.useQuery(
    { partInstanceId: partId },
    { enabled: open }
  )

  useEffect(() => {
    if (!open || costEdited) return
    setUnitCost(lastCost.data ?? null)
  }, [open, costEdited, lastCost.data])

  const adjustStock = api.purchasing.adjustStock.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to adjust stock', description: error.message })
    },
  })

  const isPending = adjustStock.isPending

  /**
   * The friendly duplicate of the server guard, not the guard itself.
   *
   * `adjustStock` refuses a zero delta and refuses an addition that does not
   * round to a positive cost; both are real `AuxxError`s. Disabling the button
   * is a better answer than a toast, but it must never be the only check —
   * `receipt-input.ts` states the same rule for the receive form.
   */
  const missingCost = isAdding && (unitCost == null || unitCost <= 0)
  const canSubmit = delta !== 0 && !missingCost

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    try {
      await adjustStock.mutateAsync({
        partId,
        quantity: delta,
        ...(delta > 0 && unitCost != null ? { unitCost } : {}),
        ...(reason ? { reason } : {}),
        ...(reference ? { reference } : {}),
      })
      onSuccess?.()
      setOpen(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }, [canSubmit, adjustStock, partId, delta, unitCost, reason, reference, onSuccess])

  const isSetToMode = quantityMode === 'set_to'

  const directionFieldOptions = useMemo(() => ({ options: DIRECTION_OPTIONS }), [])
  const quantityModeFieldOptions = useMemo(() => ({ options: QUANTITY_MODE_OPTIONS }), [])
  const currencyFieldOptions = useMemo(
    () => ({ currencyCode, decimals: 2, useGrouping: true }),
    [currencyCode]
  )

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
                  Delta: {delta >= 0 ? '+' : ''}
                  {delta}
                </p>
              )}
            </FieldPanelRow>

            {/* Unit cost — additions only. See the note on this component. */}
            {isAdding && (
              <FieldPanelRow
                title='Unit cost'
                type={BaseType.CURRENCY}
                showIcon
                isRequired
                description='What one added unit is worth'>
                <FieldInputAdapter
                  fieldType={FieldType.CURRENCY}
                  fieldOptions={currencyFieldOptions}
                  value={unitCost}
                  onChange={(val) => {
                    setUnitCost((val as number) ?? null)
                    setCostEdited(true)
                  }}
                  disabled={isPending}
                />
                <p className='text-xs text-muted-foreground mt-1'>
                  {missingCost
                    ? 'Adding stock creates inventory value, so it cannot be added at no cost.'
                    : 'Prefilled from the last receipt of this part. Overwrite it with what these units are worth.'}
                </p>
              </FieldPanelRow>
            )}

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
              loadingText='Saving...'
              disabled={!canSubmit}>
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
