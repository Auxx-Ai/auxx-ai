// apps/web/src/components/manufacturing/parts/receive-stock-popover.tsx
'use client'

// The receipt form (plans/purchasing/01-build-plan.md §3.5) — a sibling of
// `stock-adjustment-popover.tsx`, deliberately not a mode of it.
//
// 🛑 Do NOT merge the two behind a type selector. `adjust` is a count correction
// and `receive` is a purchase: a merged form has a supplier, a price and a landed
// breakdown that are all irrelevant on half its inputs, and a Direction control
// that is meaningless on the other half.
//
// The price input is PREFILLED FROM THE SUPPLIER ROW AND EDITABLE, and that is the
// point of the whole form: the standing terms are a guess, the vendor's actual
// invoice is the fact, and freezing the guess is how inventory value drifts away
// from what was really paid.
//
// 🛑 That price is the ONLY money this form sends. The landed cost is resolved
// server-side from the price it was handed plus the supplier row's adders, and
// `purchasing.receiveStock` does not accept a cost from the browser at all.
//
// The landed figure is still shown broken out beneath the input — `$47.10 =
// $44.00 + $1.20 freight + $1.90 tariff (4.3%)` — because that total is what gets
// frozen onto the movement forever, and a number nobody can check is a number
// nobody catches. It is a PREVIEW: client and server run the same
// `computeReceiptLandedCost` over the same inputs, so the figure on screen is the
// figure stored, but the server is the one that computes the stored one.

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { formatLandedCostSummary, type ReceiptCostInputs } from '@auxx/lib/receiving/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { buildReceiptInput, type ReceiptFormState, receiptBreakdown } from './receipt-input'

/** Everything the landed-cost formula needs, plus what the option label shows. */
const VENDOR_PART_ATTRIBUTES = [
  'vendor_part_vendor_sku',
  'vendor_part_unit_price',
  'vendor_part_shipping_cost',
  'vendor_part_tariff_rate',
  'vendor_part_other_cost',
  'vendor_part_is_preferred',
] as const

interface SupplierOption {
  id: string
  label: string
  isPreferred: boolean
  terms: ReceiptCostInputs
}

interface ReceiveStockPopoverProps {
  /** The part's entityInstanceId. */
  partId: string
  onSuccess?: () => void
  children: React.ReactNode
}

export function ReceiveStockPopover({ partId, onSuccess, children }: ReceiveStockPopoverProps) {
  const [open, setOpen] = useState(false)
  const [vendorPartId, setVendorPartId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState<number | null>(null)
  const [unitPrice, setUnitPrice] = useState<number | null>(null)
  // Whether the price shown is the person's own number rather than the prefill.
  // Without this, re-running the prefill effect would quietly overwrite a typed
  // price — the one value on this form that must never be overwritten.
  const [priceEdited, setPriceEdited] = useState(false)
  const [occurredAt, setOccurredAt] = useState<string>(() => new Date().toISOString())
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const suppliers = usePartSuppliers(partId, open)
  const selected = suppliers.find((option) => option.id === vendorPartId) ?? null

  // Reset to a fresh form every time the popover opens, defaulting to the
  // preferred supplier (§3.5) — the row the buyer already chose.
  useEffect(() => {
    if (!open) return
    setQuantity(null)
    setUnitPrice(null)
    setPriceEdited(false)
    setOccurredAt(new Date().toISOString())
    setReference('')
    setReason('')
    setVendorPartId(null)
  }, [open])

  // Prefill the supplier once the rows land, then the price from that supplier.
  // Split from the reset above because the rows arrive asynchronously, after it.
  useEffect(() => {
    if (!open || vendorPartId || suppliers.length === 0) return
    const preferred = suppliers.find((option) => option.isPreferred) ?? suppliers[0]
    if (preferred) setVendorPartId(preferred.id)
  }, [open, vendorPartId, suppliers])

  useEffect(() => {
    if (!open || priceEdited) return
    setUnitPrice(selected?.terms.unitPrice ?? null)
  }, [open, priceEdited, selected])

  // Everything that decides the payload, in one value — so what the breakdown
  // below renders and what the mutation sends are computed from the same state
  // by the same module (`receipt-input.ts`), not by two expressions that agree
  // today.
  const formState: ReceiptFormState = {
    partId,
    quantity,
    vendorPartId,
    terms: selected?.terms ?? null,
    unitPrice,
    occurredAt,
    reference,
    reason,
  }
  const breakdown = receiptBreakdown(formState)
  const payload = buildReceiptInput(formState)

  const receiveStock = api.purchasing.receiveStock.useMutation({
    onError: (error) =>
      toastError({ title: 'Failed to receive stock', description: error.message }),
  })

  const isPending = receiveStock.isPending

  const handleSubmit = async () => {
    if (!payload) return
    try {
      await receiveStock.mutateAsync(payload)
      onSuccess?.()
      setOpen(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const supplierOptions = useMemo(
    () => ({ options: suppliers.map((option) => ({ label: option.label, value: option.id })) }),
    [suppliers]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className='w-96' align='end'>
        <div className='space-y-3'>
          <h4 className='font-semibold text-sm'>Receive Stock</h4>

          <FieldPanel className='p-0'>
            <FieldPanelRow
              title='Supplier part'
              type={BaseType.ENUM}
              showIcon
              description='Sets the price and the freight and tariff terms'>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                value={vendorPartId}
                onChange={(val) => {
                  setVendorPartId((val as string[])[0] ?? null)
                  // A different supplier means different terms, so the prefill is
                  // live again — the typed price belonged to the old row.
                  setPriceEdited(false)
                }}
                fieldOptions={supplierOptions}
                disabled={isPending || suppliers.length === 0}
              />
            </FieldPanelRow>

            <FieldPanelRow title='Quantity' type={BaseType.NUMBER} showIcon isRequired>
              <FieldInputAdapter
                fieldType={FieldType.NUMBER}
                value={quantity}
                onChange={(val) => setQuantity((val as number) ?? null)}
                placeholder='0'
                disabled={isPending}
              />
            </FieldPanelRow>

            <FieldPanelRow
              title='Unit price'
              type={BaseType.CURRENCY}
              showIcon
              isRequired
              description='What the vendor actually charged'>
              <FieldInputAdapter
                fieldType={FieldType.CURRENCY}
                fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                value={unitPrice}
                onChange={(val) => {
                  setUnitPrice((val as number) ?? null)
                  setPriceEdited(true)
                }}
                disabled={isPending}
              />
              {breakdown && (
                <p className='mt-1 text-muted-foreground text-xs tabular-nums'>
                  {formatLandedCostSummary(breakdown, (minorUnits) =>
                    formatCurrency(minorUnits, { currencyCode })
                  )}
                  {' landed'}
                </p>
              )}
            </FieldPanelRow>

            <FieldPanelRow
              title='Received on'
              type={BaseType.DATE}
              showIcon
              isRequired
              description='The accounting date, which is not when it was keyed'>
              <FieldInputAdapter
                fieldType={FieldType.DATETIME}
                value={occurredAt}
                onChange={(val) => setOccurredAt(val as string)}
                disabled={isPending}
              />
            </FieldPanelRow>

            <FieldPanelRow title='Reference' type={BaseType.STRING} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={reference}
                onChange={(val) => setReference((val as string) ?? '')}
                placeholder='e.g. Packing slip 88213'
                disabled={isPending}
              />
            </FieldPanelRow>

            <FieldPanelRow title='Reason' type={BaseType.STRING} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={reason}
                onChange={(val) => setReason((val as string) ?? '')}
                placeholder='e.g. Partial delivery'
                disabled={isPending}
              />
            </FieldPanelRow>
          </FieldPanel>

          {suppliers.length === 0 && (
            <p className='text-muted-foreground text-xs'>
              This part has no supplier rows. Enter the price paid to receive it anyway.
            </p>
          )}

          <div className='flex justify-end gap-2'>
            <Button variant='ghost' size='xs' onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant='outline'
              size='xs'
              onClick={handleSubmit}
              loading={isPending}
              loadingText='Receiving...'
              disabled={!payload}>
              Receive
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The part's supplier rows with their priced terms, in the shape the form needs.
 *
 * The Suppliers tab's read (`part-vendors-tab.tsx`), narrowed: this form ranks
 * nothing, it only prefills, so it wants the terms and a label and not the
 * lead-time/contact columns that tab renders.
 */
function usePartSuppliers(partId: string, enabled: boolean): SupplierOption[] {
  const vendorPartDefId = useResourceProperty('vendor_part', 'id')

  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'part-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'part-match',
            fieldId: 'vendor_part:part' as ResourceFieldId,
            operator: 'is' as const,
            value: partId,
          },
        ],
      },
    ],
    [partId]
  )

  const { records } = useRecordList({
    entityDefinitionId: vendorPartDefId ?? '',
    filters,
    limit: 50,
    enabled: enabled && !!partId && !!vendorPartDefId,
  })

  const recordIds = useMemo(
    () => (vendorPartDefId ? records.map((record) => toRecordId(vendorPartDefId, record.id)) : []),
    [records, vendorPartDefId]
  )

  const { valuesById } = useSystemValuesForRecords(recordIds, VENDOR_PART_ATTRIBUTES, {
    autoFetch: true,
    enabled: enabled && recordIds.length > 0,
  })

  return useMemo(
    () =>
      records.map((record, index) => {
        const values = valuesById[recordIds[index] ?? ''] ?? ({} as Record<string, unknown>)
        const sku = values.vendor_part_vendor_sku as string | undefined
        return {
          id: record.id,
          label: record.displayName || sku || 'Supplier part',
          isPreferred: (values.vendor_part_is_preferred as boolean | undefined) ?? false,
          terms: {
            unitPrice: (values.vendor_part_unit_price as number | null | undefined) ?? null,
            shippingCost: (values.vendor_part_shipping_cost as number | null | undefined) ?? null,
            tariffRate: (values.vendor_part_tariff_rate as number | null | undefined) ?? null,
            otherCost: (values.vendor_part_other_cost as number | null | undefined) ?? null,
          },
        }
      }),
    [records, recordIds, valuesById]
  )
}
