// apps/web/src/components/purchasing/purchase-order/receive-purchase-order-dialog.tsx
'use client'

// Receive a whole purchase order in one pass (plans/purchasing/01-build-plan.md
// §3.1 / §4.3) — the door that makes receiving usable.
//
// 🛑 This is the PRIMARY receiving flow, not a convenience over the part-first
// popover. Receiving a delivery through `ReceiveStockPopover` means opening each
// part, clicking Receive and keying the same six fields per line, and the result
// is still wrong in a way nothing shows: a part-first receipt sets no
// `purchaseOrderLineId`, so `purchase_order_line_quantity_received` never moves
// and the three-way match has no receipt leg. The popover is the no-PO door — a
// one-off, a freight-only delivery — and it should stay small.
//
// Everything here is prefilled on the assumption the whole order arrived: each
// row's quantity is what is OUTSTANDING and each price is what was agreed. The
// common case is therefore Receive, with no typing at all.

import { FieldType } from '@auxx/database/enums'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { getInstanceId } from '@auxx/types/resource'
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
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useRecord } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { useFieldValueStore } from '~/components/resources/store/field-value-store'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { formatQuantity, numberValue, unwrapValue } from '../purchasing-summary-strip'
import {
  allocatedUnitCosts,
  buildReceivePoInput,
  outstandingQuantity,
  prefillDraft,
  type ReceiptDraftLine,
  type ReceiptHeader,
  type ReceivablePoLine,
  receiptSubtotal,
} from './receive-po-lines'

const PO_ATTRS = [
  'purchase_order_lines',
  'purchase_order_shipping_total',
  'purchase_order_tax_total',
  'purchase_order_discount_value',
  'purchase_order_tax_recoverable',
  'purchase_order_allocation_basis',
  'purchase_order_currency',
] as const

const LINE_ATTRS = [
  'purchase_order_line_part',
  'purchase_order_line_description',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_quantity_received',
  'purchase_order_line_expected_unit_price',
  'purchase_order_line_vendor_part',
  'purchase_order_line_weight',
] as const

interface ReceivePurchaseOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  purchaseOrderRecordId: RecordId
  onReceived?: () => void
}

export function ReceivePurchaseOrderDialog({
  open,
  onOpenChange,
  purchaseOrderRecordId,
  onReceived,
}: ReceivePurchaseOrderDialogProps) {
  const { getSetting } = useSettings({})
  const invalidateResource = useFieldValueStore((state) => state.invalidateResource)

  const { values, isLoading: poLoading } = useSystemValues(purchaseOrderRecordId, [...PO_ATTRS], {
    autoFetch: true,
  })
  const lineRecordIds = extractRelationshipRecordIds(values.purchase_order_lines)
  const { valuesById, isLoading: linesLoading } = useSystemValuesForRecords(
    lineRecordIds,
    LINE_ATTRS,
    { autoFetch: true, enabled: open && lineRecordIds.length > 0 }
  )

  const currencyValue = unwrapValue(values.purchase_order_currency)
  const currencyCode =
    (typeof currencyValue === 'string' && currencyValue) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'

  const lines: ReceivablePoLine[] = useMemo(
    () =>
      lineRecordIds.map((lineRecordId) => {
        const line = valuesById[lineRecordId] ?? ({} as Record<string, unknown>)
        const partRecordId = extractRelationshipRecordIds(line.purchase_order_line_part)[0]
        const vendorPartRecordId = extractRelationshipRecordIds(
          line.purchase_order_line_vendor_part
        )[0]
        const description = unwrapValue(line.purchase_order_line_description)
        const weight = numberValue(line.purchase_order_line_weight)
        return {
          purchaseOrderLineId: getInstanceId(lineRecordId),
          partId: partRecordId ? getInstanceId(partRecordId) : '',
          description: typeof description === 'string' && description ? description : null,
          quantityOrdered: numberValue(line.purchase_order_line_quantity_ordered),
          quantityReceived: numberValue(line.purchase_order_line_quantity_received),
          expectedUnitPrice: numberValue(line.purchase_order_line_expected_unit_price),
          ...(vendorPartRecordId ? { vendorPartId: getInstanceId(vendorPartRecordId) } : {}),
          ...(weight > 0 ? { weight } : {}),
        }
      }),
    [lineRecordIds, valuesById]
  )

  const basisValue = unwrapValue(values.purchase_order_allocation_basis)
  const header: ReceiptHeader = {
    shipping: numberValue(values.purchase_order_shipping_total),
    tax: numberValue(values.purchase_order_tax_total),
    discount: numberValue(values.purchase_order_discount_value),
    taxRecoverable: unwrapValue(values.purchase_order_tax_recoverable) === true,
    basis:
      basisValue === 'quantity' || basisValue === 'weight'
        ? basisValue
        : ('value' as ReceiptHeader['basis']),
  }

  const [draft, setDraft] = useState<Record<string, ReceiptDraftLine>>({})
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString())
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  // The prefill must re-run when the lines finish loading, but must NOT clobber a
  // quantity somebody has already corrected — so it is keyed on the line set and
  // only fires while the draft is still empty for those ids.
  const linesKey = lines.map((line) => line.purchaseOrderLineId).join(',')

  // biome-ignore lint/correctness/useExhaustiveDependencies: linesKey stands in for `lines`; re-prefill only when the set changes or the dialog reopens.
  useEffect(() => {
    if (!open) return
    setDraft(prefillDraft(lines))
    setOccurredAt(new Date().toISOString())
    setReference('')
    setReason('')
  }, [open, linesKey])

  const unitCosts = allocatedUnitCosts(lines, draft, header)
  const subtotal = receiptSubtotal(lines, draft)
  const payload = buildReceivePoInput(lines, draft, header, { occurredAt, reference, reason })

  const receive = api.purchasing.receivePurchaseOrder.useMutation({
    onError: (error) => toastError({ title: 'Failed to receive', description: error.message }),
  })

  const handleSubmit = async () => {
    if (!payload) return
    try {
      await receive.mutateAsync(payload)
      // The roll-up is a post-commit re-SUM on another connection, so the line's
      // cached `quantityReceived` is stale the instant this resolves. Drop it and
      // let `autoFetch` re-pull rather than guessing the new value.
      invalidateResource(purchaseOrderRecordId)
      for (const lineRecordId of lineRecordIds) invalidateResource(lineRecordId)
      onReceived?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const isLoading = poLoading || (lineRecordIds.length > 0 && linesLoading)
  const receivingCount = payload?.lines.length ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Receive purchase order</DialogTitle>
          <DialogDescription>
            Everything is prefilled as if the whole order arrived. Change what did not.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className='space-y-2'>
            <Skeleton className='h-8 w-full' />
            <Skeleton className='h-8 w-full' />
            <Skeleton className='h-8 w-full' />
          </div>
        ) : lines.length === 0 ? (
          <p className='py-6 text-center text-muted-foreground text-sm'>
            This purchase order has no lines.
          </p>
        ) : (
          <div className='max-h-[45vh] overflow-auto rounded-md border'>
            <table className='w-full text-sm'>
              <thead className='sticky top-0 bg-primary-50 text-muted-foreground text-xs dark:bg-background'>
                <tr>
                  <th className='px-3 py-2 text-left font-normal'>Part</th>
                  <th className='px-2 py-2 text-right font-normal'>Outstanding</th>
                  <th className='w-24 px-2 py-2 text-right font-normal'>Receive</th>
                  <th className='w-32 px-2 py-2 text-right font-normal'>Unit price</th>
                  <th className='px-3 py-2 text-right font-normal'>Landed</th>
                </tr>
              </thead>
              <tbody className='divide-y'>
                {lines.map((line, index) => (
                  <ReceiveLineRow
                    key={line.purchaseOrderLineId}
                    line={line}
                    // Positional: `lines` is built by mapping `lineRecordIds`, so
                    // the two stay index-aligned. `indexOf` would be O(n²) and
                    // would silently pick the wrong row if two lines ever compared
                    // equal.
                    lineRecordId={lineRecordIds[index]}
                    draft={draft[line.purchaseOrderLineId]}
                    landedUnitCost={unitCosts[line.purchaseOrderLineId]}
                    currencyCode={currencyCode}
                    disabled={receive.isPending}
                    onChange={(next) =>
                      setDraft((current) => ({ ...current, [line.purchaseOrderLineId]: next }))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The header amounts are the freight-allocation inputs (§4.3) — shown so the
            landed column above is explicable rather than mysterious. */}
        {(header.shipping > 0 || header.tax > 0 || header.discount > 0) && (
          <div className='flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-muted-foreground text-xs tabular-nums'>
            <span>Goods {formatCurrency(subtotal, { currencyCode })}</span>
            {header.shipping > 0 && (
              <span>+ {formatCurrency(header.shipping, { currencyCode })} freight</span>
            )}
            {header.tax > 0 && (
              <span>
                + {formatCurrency(header.tax, { currencyCode })} tax
                {header.taxRecoverable ? ' (recoverable)' : ''}
              </span>
            )}
            {header.discount > 0 && (
              <span>− {formatCurrency(header.discount, { currencyCode })} discount</span>
            )}
            <span>spread by {header.basis}</span>
          </div>
        )}

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='receive-po-form'
          defaultLabelWidth={110}
          className='p-0'>
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
              disabled={receive.isPending}
            />
          </FieldPanelRow>
          <FieldPanelRow title='Reference' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={reference}
              onChange={(val) => setReference((val as string) ?? '')}
              placeholder='e.g. Packing slip 88213'
              disabled={receive.isPending}
            />
          </FieldPanelRow>
          <FieldPanelRow title='Reason' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={reason}
              onChange={(val) => setReason((val as string) ?? '')}
              placeholder='e.g. Partial delivery'
              disabled={receive.isPending}
            />
          </FieldPanelRow>
        </FieldPanel>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={receive.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={receive.isPending}
            loadingText='Receiving...'
            disabled={!payload}
            data-dialog-submit>
            {receivingCount > 0
              ? `Receive ${receivingCount} line${receivingCount === 1 ? '' : 's'}`
              : 'Receive'}
            <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReceiveLineRow({
  line,
  lineRecordId,
  draft,
  landedUnitCost,
  currencyCode,
  disabled,
  onChange,
}: {
  line: ReceivablePoLine
  lineRecordId: RecordId | undefined
  draft: ReceiptDraftLine | undefined
  landedUnitCost: number | undefined
  currencyCode: string
  disabled: boolean
  onChange: (next: ReceiptDraftLine) => void
}) {
  const { record } = useRecord({ recordId: lineRecordId!, enabled: !!lineRecordId })
  const quantity = draft?.quantity ?? 0
  const unitPrice = draft?.unitPrice ?? line.expectedUnitPrice
  const outstanding = outstandingQuantity(line)

  return (
    <tr className={quantity > 0 ? undefined : 'opacity-50'}>
      <td className='px-3 py-1.5'>
        <span className='truncate'>{record?.displayName ?? line.description ?? 'Line'}</span>
      </td>
      <td className='px-2 py-1.5 text-right text-muted-foreground tabular-nums'>
        {formatQuantity(outstanding)}
        <span className='ml-1 text-xs'>of {formatQuantity(line.quantityOrdered)}</span>
      </td>
      <td className='px-2 py-1.5'>
        <FieldInputAdapter
          fieldType={FieldType.NUMBER}
          value={quantity}
          onChange={(val) => onChange({ quantity: (val as number) ?? 0, unitPrice })}
          disabled={disabled}
        />
      </td>
      <td className='px-2 py-1.5'>
        <FieldInputAdapter
          fieldType={FieldType.CURRENCY}
          fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
          value={unitPrice}
          onChange={(val) => onChange({ quantity, unitPrice: (val as number) ?? 0 })}
          disabled={disabled}
        />
      </td>
      <td className='px-3 py-1.5 text-right tabular-nums'>
        {landedUnitCost != null ? formatCurrency(landedUnitCost, { currencyCode }) : '—'}
      </td>
    </tr>
  )
}
