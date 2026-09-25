// apps/web/src/components/purchasing/vendor-bill/manual-bill-form.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { usePurchaseOrderLines } from '../purchase-order/use-purchase-order-lines'
import { numberValue, PurchasingSummaryStrip, unwrapValue } from '../purchasing-summary-strip'
import { billLinesFromPurchaseOrder, selectBillableLines } from './bill-lines-from-purchase-order'

interface BillDraft {
  number: string
  billedAt: string | null
  dueAt: string | null
  subtotal: number | null
  shippingTotal: number | null
  taxTotal: number | null
  discount: number | null
  total: number | null
}

const EMPTY_DRAFT: BillDraft = {
  number: '',
  billedAt: null,
  dueAt: null,
  subtotal: null,
  shippingTotal: null,
  taxTotal: null,
  discount: null,
  total: null,
}

const PO_ATTRS = [
  'purchase_order_currency',
  'purchase_order_total',
  'purchase_order_subtotal',
  'purchase_order_shipping_total',
  'purchase_order_tax_total',
  'purchase_order_discount_value',
  'purchase_order_bills',
] as const

const BILL_ATTRS = [
  'vendor_bill_total',
  'vendor_bill_subtotal',
  'vendor_bill_shipping_total',
  'vendor_bill_tax_total',
] as const

const AMOUNT_LABELS = {
  subtotal: 'Subtotal',
  shippingTotal: 'Shipping',
  taxTotal: 'Tax',
  discount: 'Discount',
} as const

export interface ManualBillFormProps {
  vendorRecordId: RecordId | null
  purchaseOrderRecordId: RecordId | null
  onBack: () => void
  onCreated: (billRecordId: RecordId) => void
  onCancel: () => void
}

/** The existing transcription form, with vendor required and the PO optional. */
export function ManualBillForm({
  vendorRecordId,
  purchaseOrderRecordId,
  onBack,
  onCreated,
  onCancel,
}: ManualBillFormProps) {
  const { getSetting } = useSettings({})
  const [draft, setDraft] = useState<BillDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [totalIsPrefilled, setTotalIsPrefilled] = useState(false)
  const [addLines, setAddLines] = useState(true)

  const billDefId = useResourceProperty('vendor_bill', 'id')
  const lineDefId = useResourceProperty('vendor_bill_line', 'id')
  const { values } = useSystemValues(purchaseOrderRecordId, [...PO_ATTRS], {
    autoFetch: true,
    enabled: Boolean(purchaseOrderRecordId),
  })
  const billRecordIds = extractRelationshipRecordIds(values.purchase_order_bills)
  const { valuesById, loadedById } = useSystemValuesForRecords(billRecordIds, BILL_ATTRS, {
    autoFetch: true,
    enabled: billRecordIds.length > 0,
  })
  const figuresLoaded =
    billRecordIds.length === 0 ||
    billRecordIds.every((id) => BILL_ATTRS.every((attr) => loadedById[id]?.[attr]))

  const currencyValue = unwrapValue(values.purchase_order_currency)
  const currencyCode =
    (typeof currencyValue === 'string' && currencyValue) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'
  const orderTotal = numberValue(values.purchase_order_total)
  const billed = billRecordIds.reduce(
    (sum, id) => sum + numberValue(valuesById[id]?.vendor_bill_total),
    0
  )
  const unbilled = orderTotal - billed
  const remainder = (orderAttr: (typeof PO_ATTRS)[number], billAttr: (typeof BILL_ATTRS)[number]) =>
    numberValue(values[orderAttr]) -
    billRecordIds.reduce((sum, id) => sum + numberValue(valuesById[id]?.[billAttr]), 0)
  const hasDiscount = numberValue(values.purchase_order_discount_value) !== 0
  const unbilledSubtotal = remainder('purchase_order_subtotal', 'vendor_bill_subtotal')
  const unbilledShipping = remainder('purchase_order_shipping_total', 'vendor_bill_shipping_total')
  const unbilledTax = remainder('purchase_order_tax_total', 'vendor_bill_tax_total')

  const { lines: orderLines } = usePurchaseOrderLines(purchaseOrderRecordId)
  const billableLines = selectBillableLines(orderLines, [])

  useEffect(() => {
    if (!purchaseOrderRecordId || !figuresLoaded) return
    setDraft((previous) => {
      const next = { ...previous }
      if (previous.total === null && unbilled > 0) {
        next.total = unbilled
        setTotalIsPrefilled(true)
      }
      if (!hasDiscount) {
        if (previous.subtotal === null && unbilledSubtotal > 0) next.subtotal = unbilledSubtotal
        if (previous.shippingTotal === null && unbilledShipping > 0)
          next.shippingTotal = unbilledShipping
        if (previous.taxTotal === null && unbilledTax > 0) next.taxTotal = unbilledTax
      }
      return next
    })
  }, [
    purchaseOrderRecordId,
    figuresLoaded,
    unbilled,
    hasDiscount,
    unbilledSubtotal,
    unbilledShipping,
    unbilledTax,
  ])

  const createRecord = api.record.create.useMutation({
    onError: (error) => toastError({ title: 'Error adding bill', description: error.message }),
  })
  const createManyRecords = api.record.createMany.useMutation({
    onError: (error) =>
      toastError({
        title: 'Bill added, but its lines were not',
        description: `${error.message} Add them from the bill's Lines card.`,
      }),
  })

  const change = <K extends keyof BillDraft>(key: K, value: BillDraft[K]) => {
    if (key === 'total') setTotalIsPrefilled(false)
    setDraft((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => {
      if (!previous[key]) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })
  }

  const submit = async () => {
    const next: Record<string, string> = {}
    if (!vendorRecordId) next.vendor = 'Pick a vendor before adding the bill'
    if (!draft.number.trim()) next.number = "Enter the number on the supplier's invoice"
    if (draft.total === null) next.total = 'Enter the invoice total as billed'
    setErrors(next)
    if (Object.keys(next).length > 0 || !billDefId || !vendorRecordId) return

    const created = await createRecord.mutateAsync({
      entityDefinitionId: billDefId,
      values: {
        vendor_bill_vendor: vendorRecordId,
        ...(purchaseOrderRecordId ? { vendor_bill_purchase_order: purchaseOrderRecordId } : {}),
        vendor_bill_number: draft.number.trim(),
        vendor_bill_billed_at: draft.billedAt,
        vendor_bill_due_at: draft.dueAt,
        vendor_bill_currency: currencyCode,
        vendor_bill_subtotal: draft.subtotal,
        vendor_bill_shipping_total: draft.shippingTotal,
        vendor_bill_tax_total: draft.taxTotal,
        vendor_bill_discount: draft.discount,
        vendor_bill_total: draft.total,
      },
    })
    if (created?.recordId && addLines && lineDefId && billableLines.length > 0) {
      await createManyRecords
        .mutateAsync({
          entityDefinitionId: lineDefId,
          records: billLinesFromPurchaseOrder(billableLines, created.recordId as RecordId, 0),
        })
        .catch(() => undefined)
    }
    if (created?.recordId) onCreated(created.recordId as RecordId)
  }

  const pending = createRecord.isPending || createManyRecords.isPending
  const totalVariance = draft.total === null ? 0 : draft.total - unbilled
  const totalDescription = totalIsPrefilled
    ? 'Prefilled from the unbilled amount. Check it against the invoice.'
    : totalVariance === 0 || !purchaseOrderRecordId
      ? 'As printed. Never summed from the lines.'
      : totalVariance > 0
        ? `As printed. ${formatCurrency(totalVariance, { currencyCode })} more than this order has unbilled.`
        : `As printed. ${formatCurrency(-totalVariance, { currencyCode })} less than this order has unbilled.`

  return (
    <div className='flex flex-col'>
      <div className='max-h-[min(65vh,42rem)] overflow-y-auto p-3'>
        {purchaseOrderRecordId && (
          <PurchasingSummaryStrip
            cells={[
              { label: 'Order total', value: formatCurrency(orderTotal, { currencyCode }) },
              { label: 'Already billed', value: formatCurrency(billed, { currencyCode }) },
              {
                label: 'Unbilled',
                value: formatCurrency(unbilled, { currencyCode }),
                tone: unbilled === 0 ? 'muted' : 'default',
              },
            ]}
          />
        )}
        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='add-bill-manual'
          defaultLabelWidth={125}
          className='mt-4 p-0'>
          <FieldPanelRow
            title='Vendor'
            type={BaseType.RELATION}
            showIcon
            isRequired
            validationError={errors.vendor}
            validationType='error'>
            {vendorRecordId ? (
              <RecordBadge recordId={vendorRecordId} />
            ) : (
              <span className='text-destructive text-sm'>Pick a vendor on the previous page</span>
            )}
          </FieldPanelRow>
          <FieldPanelRow title='Purchase order' type={BaseType.RELATION} showIcon>
            {purchaseOrderRecordId ? (
              <RecordBadge recordId={purchaseOrderRecordId} />
            ) : (
              <span className='text-muted-foreground text-sm'>No purchase order</span>
            )}
          </FieldPanelRow>
          <FieldPanelRow
            title='Bill number'
            type={BaseType.STRING}
            showIcon
            isRequired
            description="The supplier's own invoice number, not the internal one"
            validationError={errors.number}
            validationType='error'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.number}
              onChange={(value) => change('number', (value as string) ?? '')}
              placeholder='e.g. INV-88213'
              disabled={pending}
            />
          </FieldPanelRow>
          <FieldPanelRow title='Bill date' type={BaseType.DATE} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.DATE}
              value={draft.billedAt}
              onChange={(value) => change('billedAt', (value as string) ?? null)}
              disabled={pending}
              triggerProps={{ className: 'ps-0' }}
            />
          </FieldPanelRow>
          <FieldPanelRow title='Due date' type={BaseType.DATE} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.DATE}
              value={draft.dueAt}
              onChange={(value) => change('dueAt', (value as string) ?? null)}
              disabled={pending}
              triggerProps={{ className: 'ps-0' }}
            />
          </FieldPanelRow>
          {(['subtotal', 'shippingTotal', 'taxTotal', 'discount'] as const).map((key) => (
            <FieldPanelRow key={key} title={AMOUNT_LABELS[key]} type={BaseType.NUMBER} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.CURRENCY}
                fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                value={draft[key]}
                onChange={(value) => change(key, value as number | null)}
                disabled={pending}
                triggerProps={{ className: 'ps-0' }}
              />
            </FieldPanelRow>
          ))}
          <FieldPanelRow
            title='Total'
            type={BaseType.NUMBER}
            showIcon
            isRequired
            description={totalDescription}
            validationError={errors.total}
            validationType='error'>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={draft.total}
              onChange={(value) => change('total', value as number | null)}
              disabled={pending}
              triggerProps={{ className: 'ps-0' }}
            />
          </FieldPanelRow>
        </FieldPanel>
        {billableLines.length > 0 && purchaseOrderRecordId && (
          <label className='mt-3 flex cursor-pointer items-start gap-2 px-1 text-sm'>
            <Checkbox
              checked={addLines}
              onCheckedChange={(checked) => setAddLines(checked === true)}
              disabled={pending}
              className='mt-0.5'
            />
            <span>
              <span>
                Add {billableLines.length} line{billableLines.length === 1 ? '' : 's'} from the
                order
              </span>
              <span className='block text-muted-foreground text-xs'>
                Part and description are filled in. Enter quantity and price from the invoice.
              </span>
            </span>
          </label>
        )}
      </div>
      <DialogFooter className='mt-0 border-t p-3'>
        <Button variant='ghost' size='sm' onClick={onCancel} disabled={pending}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='sm' onClick={onBack} disabled={pending}>
            Change
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void submit()}
            loading={pending}
            loadingText='Adding...'
            disabled={!billDefId || !vendorRecordId}
            data-dialog-submit>
            Add bill <KbdSubmit variant='outline' size='sm' />
          </Button>
        </div>
      </DialogFooter>
    </div>
  )
}
