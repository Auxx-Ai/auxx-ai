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
//
// 🛑 The line set comes from `usePurchaseOrderLines` — the LIST lane — and here
// that is a correctness requirement, not a freshness nicety. This dialog does not
// merely display the lines: `buildReceivePoInput` turns them into the write. Read
// off the PO's `purchase_order_lines` inverse (as this did), a line added earlier
// in the same session is simply absent from the mirror — the fetch queue skips a
// key already in the store, so not even reopening the dialog repairs it — and the
// receipt is then built from a short line set. Nothing throws: the order reports
// received and the missing line silently sits at `0 / n`. See the hook's own note
// and B-9/D-11 in `plans/events/`.

import { FieldType } from '@auxx/database/enums'
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
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { Package } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useRecord } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import {
  formatQuantity,
  numberValue,
  PurchasingSummaryStrip,
  type SummaryCell,
  unwrapValue,
} from '../purchasing-summary-strip'
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
import { usePurchaseOrderLines } from './use-purchase-order-lines'

// The PO's OWN fields — written on the PO and published normally, so
// `useSystemValues` is the right read for them. `purchase_order_lines` is not
// here on purpose; see the note above.
const PO_ATTRS = [
  'purchase_order_shipping_total',
  'purchase_order_tax_total',
  'purchase_order_discount_value',
  'purchase_order_tax_recoverable',
  'purchase_order_allocation_basis',
  'purchase_order_currency',
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

  const { values, isLoading: poLoading } = useSystemValues(purchaseOrderRecordId, [...PO_ATTRS], {
    autoFetch: true,
  })
  // Same hook the Receiving card behind this dialog uses, so both resolve one
  // line set from one fetch — the card and the receipt can never disagree about
  // what is on the order.
  const { lines: poLines, isLoading: linesLoading } = usePurchaseOrderLines(purchaseOrderRecordId)

  const currencyValue = unwrapValue(values.purchase_order_currency)
  const currencyCode =
    (typeof currencyValue === 'string' && currencyValue) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'

  // Two shapes out of one pass over the lines. `ReceivablePoLine[]` is the SERVER
  // payload's shape, so its `partId` is a bare instance id — which cannot address
  // a record and therefore cannot resolve a part NAME. The rows need that name, so
  // the part's `RecordId` rides alongside in a map keyed on `purchaseOrderLineId`
  // rather than as a UI-only field bolted onto the payload type.
  const { lines, partRecordIds } = useMemo(() => {
    const partRecordIds: Record<string, RecordId | undefined> = {}
    const lines: ReceivablePoLine[] = poLines.map((line) => {
      const purchaseOrderLineId = getInstanceId(line.lineRecordId)
      partRecordIds[purchaseOrderLineId] = line.partRecordId ?? undefined
      return {
        purchaseOrderLineId,
        partId: line.partRecordId ? getInstanceId(line.partRecordId) : '',
        description: line.description,
        quantityOrdered: line.ordered,
        quantityReceived: line.received,
        expectedUnitPrice: line.expectedUnitPrice,
        // Spread-or-omit, not `undefined`: both are optional on the server
        // payload and an explicit `undefined` is a different shape.
        ...(line.vendorPartRecordId
          ? { vendorPartId: getInstanceId(line.vendorPartRecordId) }
          : {}),
        ...(line.weight > 0 ? { weight: line.weight } : {}),
      }
    })
    return { lines, partRecordIds }
  }, [poLines])

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
      // NO invalidation here, deliberately. The roll-up is a post-commit re-SUM
      // that ends in `publishFieldValueUpdates`, and `useResourceSync` merges
      // that into the field-value store with `setValues` — a non-destructive
      // write of exactly the one field that changed.
      //
      // 🛑 Do NOT reintroduce `invalidateResource` here. It DELETES every cached
      // field value for the record, so invalidating the PO dropped its
      // `purchase_order_lines` relationship and invalidating each line dropped
      // that line's part, description, quantity and price — which is what made
      // the drawer's line builder visibly reset itself on every receipt. It also
      // ran one store write per line, re-rendering every subscriber N times.
      onReceived?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const isLoading = poLoading || linesLoading
  const receivingCount = payload?.lines.length ?? 0

  // The header amounts are the freight-allocation inputs (§4.3) — shown so the
  // landed column above is explicable rather than mysterious.
  const landedCells: SummaryCell[] = [
    { label: 'Goods', value: formatCurrency(subtotal, { currencyCode }) },
    ...(header.shipping > 0
      ? [{ label: 'Freight', value: `+ ${formatCurrency(header.shipping, { currencyCode })}` }]
      : []),
    ...(header.tax > 0
      ? [
          {
            label: header.taxRecoverable ? 'Tax (recoverable)' : 'Tax',
            value: `+ ${formatCurrency(header.tax, { currencyCode })}`,
          },
        ]
      : []),
    ...(header.discount > 0
      ? [{ label: 'Discount', value: `− ${formatCurrency(header.discount, { currencyCode })}` }]
      : []),
    { label: 'Spread by', value: header.basis, tone: 'muted' },
  ]
  const showLandedCells = header.shipping > 0 || header.tax > 0 || header.discount > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='xxl'>
        <DialogHeader>
          <DialogTitle>Receive purchase order</DialogTitle>
          <DialogDescription>
            Everything is prefilled as if the whole order arrived. Change what did not.
          </DialogDescription>
        </DialogHeader>

        {/* One rhythm for the three body blocks — the table, the allocation strip
            and the receipt form. `DialogHeader` carries its own `mb-4` and
            `DialogFooter` its own `pt-4`, so only the middle needs spacing. */}
        <div className='space-y-4'>
          {isLoading ? (
            <div className='space-y-2 rounded-md border p-3'>
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-8 w-full' />
            </div>
          ) : lines.length === 0 ? (
            <EmptySection
              icon={<Package className='size-5' />}
              title='Nothing to receive'
              description='This purchase order has no lines.'
            />
          ) : (
            <div className='max-h-[45vh] overflow-auto rounded-md border'>
              {/* The design-system cells on a bare `<table>` rather than the `Table`
                  wrapper: that wrapper adds its own unconstrained `overflow-auto`
                  div, which would become the sticky header's scrollport and pin the
                  header to a box that never scrolls. Same shape as `audit-table.tsx`.
                  `table-fixed` is what lets the part cell actually truncate. */}
              <table className='w-full min-w-[36rem] table-fixed caption-bottom text-sm'>
                <TableHeader className='sticky top-0 z-10 bg-muted'>
                  <TableRow className='hover:bg-muted'>
                    <TableHead>Part</TableHead>
                    <TableHead className='w-[7.5rem] text-right'>Outstanding</TableHead>
                    <TableHead className='w-[7rem] text-right'>Receive</TableHead>
                    <TableHead className='w-[9rem] text-right'>Unit price</TableHead>
                    <TableHead className='w-[7rem] text-right'>Landed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <ReceiveLineRow
                      key={line.purchaseOrderLineId}
                      line={line}
                      partRecordId={partRecordIds[line.purchaseOrderLineId]}
                      draft={draft[line.purchaseOrderLineId]}
                      landedUnitCost={unitCosts[line.purchaseOrderLineId]}
                      currencyCode={currencyCode}
                      disabled={receive.isPending}
                      onChange={(next) =>
                        setDraft((current) => ({ ...current, [line.purchaseOrderLineId]: next }))
                      }
                    />
                  ))}
                </TableBody>
              </table>
            </div>
          )}

          {showLandedCells && (
            <PurchasingSummaryStrip className='rounded-md border px-3 py-2' cells={landedCells} />
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
        </div>

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

/**
 * The affordance that stops an editable cell reading as loose text: right-aligned
 * tabular figures, plus a muted fill on hover/focus so the cell advertises that it
 * can be typed into. `FieldInputAdapter` takes no `className`, so the alignment is
 * pushed down onto its `<input>` from here.
 */
function EditableNumberCell({ children }: { children: ReactNode }) {
  return (
    <div className='rounded-md ring-1 ring-transparent transition-colors focus-within:bg-muted/60 focus-within:ring-ring/30 hover:bg-muted/60 [&_input]:tabular-nums [&_input]:text-right'>
      {children}
    </div>
  )
}

function ReceiveLineRow({
  line,
  partRecordId,
  draft,
  landedUnitCost,
  currencyCode,
  disabled,
  onChange,
}: {
  line: ReceivablePoLine
  partRecordId: RecordId | undefined
  draft: ReceiptDraftLine | undefined
  landedUnitCost: number | undefined
  currencyCode: string
  disabled: boolean
  onChange: (next: ReceiptDraftLine) => void
}) {
  const { record } = useRecord({ recordId: partRecordId!, enabled: !!partRecordId })
  const quantity = draft?.quantity ?? 0
  const unitPrice = draft?.unitPrice ?? line.expectedUnitPrice
  const outstanding = outstandingQuantity(line)

  // The part IS a buy-side line's identity (03-line-builder-reuse.md), so it leads;
  // `description` is the fallback for a line whose part has not resolved yet. Same
  // chain as `ReceivingLineRow` in `purchase-order-receiving-card.tsx` — the LINE's
  // own `displayName` is its raw instance id and must never be shown.
  const title = record?.displayName ?? line.description ?? 'Untitled line'

  return (
    <TableRow className={cn(quantity > 0 ? undefined : 'opacity-50')}>
      <TableCell className='py-1.5 pr-2 pl-3'>
        <span className='block truncate' title={title}>
          {title}
        </span>
      </TableCell>
      <TableCell className='px-2 py-1.5 text-right text-muted-foreground tabular-nums'>
        {formatQuantity(outstanding)}
        <span className='ml-1 text-xs'>of {formatQuantity(line.quantityOrdered)}</span>
      </TableCell>
      <TableCell className='px-1 py-1'>
        <EditableNumberCell>
          <FieldInputAdapter
            fieldType={FieldType.NUMBER}
            value={quantity}
            onChange={(val) => onChange({ quantity: (val as number) ?? 0, unitPrice })}
            disabled={disabled}
          />
        </EditableNumberCell>
      </TableCell>
      <TableCell className='px-1 py-1'>
        <EditableNumberCell>
          <FieldInputAdapter
            fieldType={FieldType.CURRENCY}
            fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
            value={unitPrice}
            onChange={(val) => onChange({ quantity, unitPrice: (val as number) ?? 0 })}
            disabled={disabled}
          />
        </EditableNumberCell>
      </TableCell>
      <TableCell className='py-1.5 pr-3 pl-2 text-right tabular-nums'>
        {landedUnitCost != null ? formatCurrency(landedUnitCost, { currencyCode }) : '—'}
      </TableCell>
    </TableRow>
  )
}
