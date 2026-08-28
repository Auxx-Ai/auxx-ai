// apps/web/src/components/purchasing/purchase-order/create-bill-from-purchase-order-dialog.tsx
'use client'

// Enter a vendor's invoice against the order it belongs to — the Bills card's
// header action, and the missing half of `purchase_order:bills`.
//
// Until this existed the card could PAY a bill and not create one: bills were
// raised from the `vendor-bills` list route, where the purchase order is a field
// somebody has to remember to set. That is not a cosmetic gap. A bill with no PO
// cannot be matched — `PurchaseOrderLinePicker` disables itself, because with no
// order there is nothing to match against — so a bill entered the long way is
// only matchable if whoever typed it linked it by hand. Coming in from the order
// makes the link a fact rather than a step.
//
// 🛑 Deliberately NOT the generic `RecordEditorDialog`. `vendor_bill` has no
// custom editor, so it would fall through to `EntityInstanceForm`, whose field
// pool is `creatable !== false && !hidden` — eighteen fields for this def,
// including all five PAYMENT fields (`paidAt`, `amountPaid`, `paymentMethod`,
// `paymentReference`, `paidSource`) and raw relationship pickers for `lines` and
// `paymentAllocations`. Paying is `MarkBillPaidDialog`'s job and lines are added
// on the bill's own card; offering them here invites a payment that never posts.
//
// **Total is prefilled to the order's unbilled amount, and that is a deliberate
// exception to the transcription rule** — narrow enough to be safe and worth
// stating, because the rule itself is not negotiable elsewhere.
//
// It is safe here because the header total is NOT a match input: `matchBill`
// weighs `quantityBilled` and `unitPriceBilled` off the LINES. The header total
// drives `vendor_bill_balance`, the Bills card's figures and the `canPay` gate —
// so a wrong one records the wrong payable, which is an A/P accuracy problem, not
// a corrupted match. And in the common case (one invoice for the whole order) the
// unbilled amount IS the invoice total, so the prefill is right far more often
// than not.
//
// What the prefill must not become is an ANCHOR — a number accepted without
// checking it against the paper. Three things keep it honest:
//   - it fills ONCE per opening, only while untouched, so it never overwrites
//     typing (values arrive async, so this cannot be a plain initial state);
//   - the field is marked prefilled until edited, and says so;
//   - once edited, any difference from the unbilled amount is named under the
//     field. A short-bill is normal (a partial delivery); an over-bill is the
//     news. Neither is blocked — both are stated.
//
// The other three amounts are NOT prefilled. Subtotal/shipping/tax are pure
// transcription with no order-side figure that is even a good guess.

import { FieldType } from '@auxx/database/enums'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
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
import { numberValue, PurchasingSummaryStrip, unwrapValue } from '../purchasing-summary-strip'
import {
  billLinesFromPurchaseOrder,
  selectBillableLines,
} from '../vendor-bill/bill-lines-from-purchase-order'
import { usePurchaseOrderLines } from './use-purchase-order-lines'

const PO_ATTRS = [
  'purchase_order_vendor',
  'purchase_order_currency',
  'purchase_order_total',
  'purchase_order_subtotal',
  'purchase_order_shipping_total',
  'purchase_order_tax_total',
  'purchase_order_discount_value',
  'purchase_order_bills',
] as const

/** Read off every bill already against the order, to subtract from the prefills. */
const BILL_ATTRS = [
  'vendor_bill_total',
  'vendor_bill_subtotal',
  'vendor_bill_shipping_total',
  'vendor_bill_tax_total',
] as const

interface BillDraft {
  /** The vendor's OWN invoice number. `internalNumber` is the sequence hook's. */
  number: string
  billedAt: string | null
  dueAt: string | null
  subtotal: number | null
  shippingTotal: number | null
  taxTotal: number | null
  total: number | null
}

const EMPTY_DRAFT: BillDraft = {
  number: '',
  billedAt: null,
  dueAt: null,
  subtotal: null,
  shippingTotal: null,
  taxTotal: null,
  total: null,
}

export interface CreateBillFromPurchaseOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  purchaseOrderRecordId: RecordId
  /** Opens the saved bill — the card peeks it. */
  onCreated?: (billRecordId: RecordId) => void
}

export function CreateBillFromPurchaseOrderDialog({
  open,
  onOpenChange,
  purchaseOrderRecordId,
  onCreated,
}: CreateBillFromPurchaseOrderDialogProps) {
  const { getSetting } = useSettings({})
  const [draft, setDraft] = useState<BillDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Distinguishes "we filled this" from "somebody typed this" — the difference
  // between a suggestion and a transcription, which the row below states.
  const [totalIsPrefilled, setTotalIsPrefilled] = useState(false)

  const billDefId = useResourceProperty('vendor_bill', 'id')

  const { values } = useSystemValues(purchaseOrderRecordId, [...PO_ATTRS], {
    autoFetch: true,
    enabled: open,
  })

  const vendorRecordId = extractRelationshipRecordIds(values.purchase_order_vendor)[0] ?? null
  const billRecordIds = extractRelationshipRecordIds(values.purchase_order_bills)
  const { valuesById } = useSystemValuesForRecords(billRecordIds, BILL_ATTRS, {
    autoFetch: true,
    enabled: open && billRecordIds.length > 0,
  })

  /** An order figure minus what every existing bill already charged for it. */
  const remainder = (orderAttr: (typeof PO_ATTRS)[number], billAttr: (typeof BILL_ATTRS)[number]) =>
    numberValue(values[orderAttr]) -
    billRecordIds.reduce(
      (sum, billRecordId) => sum + numberValue(valuesById[billRecordId]?.[billAttr]),
      0
    )

  const currencyValue = unwrapValue(values.purchase_order_currency)
  const currencyCode =
    (typeof currencyValue === 'string' && currencyValue) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'

  const orderTotal = numberValue(values.purchase_order_total)
  const billed = billRecordIds.reduce(
    (sum, billRecordId) => sum + numberValue(valuesById[billRecordId]?.vendor_bill_total),
    0
  )
  // Signed, like the Bills card's: an order already over-billed is the news, and
  // clamping it to zero would hide exactly the case worth seeing before adding one more.
  const unbilled = orderTotal - billed

  // 🛑 The subtraction is what makes the component prefills safe on a SECOND
  // bill, and freight is the case that proves it: an order's $50 shipping is
  // normally charged in full on the first invoice, so prefilling the order's
  // figure again would double it. Its remainder is 0 by then, which is correct.
  //
  // Skipped entirely when the order carries a discount. A bill has no discount
  // field — `subtotal`/`shipping`/`tax`/`total` is the whole set — so on a
  // discounted order the three components cannot reconcile with the total, and
  // four prefilled numbers that visibly do not add up on a transcription form
  // teach people to distrust all of them. Total still prefills: it carries the
  // discount already and it is the figure that drives balance and payment.
  const hasDiscount = numberValue(values.purchase_order_discount_value) !== 0
  const unbilledSubtotal = remainder('purchase_order_subtotal', 'vendor_bill_subtotal')
  const unbilledShipping = remainder('purchase_order_shipping_total', 'vendor_bill_shipping_total')
  const unbilledTax = remainder('purchase_order_tax_total', 'vendor_bill_tax_total')

  // Default ON: the order was received, so the invoice in hand is almost always
  // for those lines. Off is the escape hatch for an invoice that bills something
  // the order does not carry at all.
  const [addLines, setAddLines] = useState(true)

  useEffect(() => {
    if (!open) return
    setDraft(EMPTY_DRAFT)
    setErrors({})
    setTotalIsPrefilled(false)
    setAddLines(true)
  }, [open])

  // The order's values arrive after the dialog opens, so the prefill cannot be
  // initial state. Guarded on `total === null` rather than on a "has run" flag:
  // that is what makes it unable to overwrite typing, including a total the user
  // deliberately cleared to zero.
  useEffect(() => {
    if (!open) return
    setDraft((prev) => {
      const next = { ...prev }
      if (prev.total === null && unbilled > 0) {
        next.total = unbilled
        setTotalIsPrefilled(true)
      }
      if (!hasDiscount) {
        if (prev.subtotal === null && unbilledSubtotal > 0) next.subtotal = unbilledSubtotal
        if (prev.shippingTotal === null && unbilledShipping > 0)
          next.shippingTotal = unbilledShipping
        if (prev.taxTotal === null && unbilledTax > 0) next.taxTotal = unbilledTax
      }
      return next
    })
  }, [open, unbilled, hasDiscount, unbilledSubtotal, unbilledShipping, unbilledTax])

  // The order's received-but-unbilled lines, raised onto the new bill so the
  // person holding the invoice types NUMBERS rather than rebuilding its line list
  // (plans/purchasing/02-handoff.md §4 item 3c). Prefills no match input — see
  // `bill-lines-from-purchase-order.ts`.
  //
  // A new bill has no lines yet, so nothing is already taken.
  const { lines: orderLines } = usePurchaseOrderLines(purchaseOrderRecordId)
  const billableLines = selectBillableLines(orderLines, [])
  const lineDefId = useResourceProperty('vendor_bill_line', 'id')

  const createRecord = api.record.create.useMutation({
    onError: (error) => toastError({ title: 'Error adding bill', description: error.message }),
  })
  // 🛑 Its failure is deliberately NOT fatal to the bill. The bill is already
  // committed by the time this runs, and a bill with no lines is exactly the state
  // every bill was in before this existed — recoverable in one press from the
  // Lines card's own "Add lines from order". Rolling the bill back to protect its
  // lines would trade a recoverable state for a lost one.
  const createManyRecords = api.record.createMany.useMutation({
    onError: (error) =>
      toastError({
        title: 'Bill added, but its lines were not',
        description: `${error.message} — add them from the bill's Lines card.`,
      }),
  })

  const change = <K extends keyof BillDraft>(key: K, value: BillDraft[K]) => {
    if (key === 'total') setTotalIsPrefilled(false)
    setDraft((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const handleSubmit = async () => {
    const next: Record<string, string> = {}
    if (!draft.number.trim()) next.number = "Enter the number on the supplier's invoice"
    // Not pedantry: a bill with no total cannot be paid (`canPay` requires
    // `total > 0`) and gives the match nothing to weigh, so it would land as a
    // row that looks entered and does nothing.
    if (draft.total === null) next.total = 'Enter the invoice total as billed'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    if (!billDefId || !vendorRecordId) return

    // `status` is left unset on purpose — `vendor_bill_status` carries
    // `defaultValue: VendorBillStatus.DRAFT` and create fills missing keys from
    // field defaults, so the lifecycle starts where it should without this
    // surface asserting a status of its own.
    const created = await createRecord.mutateAsync({
      entityDefinitionId: billDefId,
      values: {
        vendor_bill_vendor: vendorRecordId,
        vendor_bill_purchase_order: purchaseOrderRecordId,
        vendor_bill_number: draft.number.trim(),
        vendor_bill_billed_at: draft.billedAt,
        vendor_bill_due_at: draft.dueAt,
        vendor_bill_currency: currencyCode,
        vendor_bill_subtotal: draft.subtotal,
        vendor_bill_shipping_total: draft.shippingTotal,
        vendor_bill_tax_total: draft.taxTotal,
        vendor_bill_total: draft.total,
      },
    })

    if (created?.recordId && addLines && lineDefId && billableLines.length > 0) {
      await createManyRecords
        .mutateAsync({
          entityDefinitionId: lineDefId,
          records: billLinesFromPurchaseOrder(billableLines, created.recordId as RecordId, 0),
        })
        // Handled by the mutation's own `onError`; the bill still opens.
        .catch(() => undefined)
    }

    onOpenChange(false)
    if (created?.recordId) onCreated?.(created.recordId)
  }

  const isPending = createRecord.isPending || createManyRecords.isPending

  // What the Total row says about itself, in the three states it can be in. The
  // point of the third is that a difference from the order is NORMAL as often as
  // not — a partial delivery bills short — so it is named, never blocked.
  const totalVariance = draft.total === null ? 0 : draft.total - unbilled
  const totalDescription = totalIsPrefilled
    ? 'Prefilled from the unbilled amount — check it against the invoice.'
    : totalVariance === 0
      ? 'As printed. Never summed from the lines.'
      : totalVariance > 0
        ? `As printed. ${formatCurrency(totalVariance, { currencyCode })} MORE than this order has unbilled.`
        : `As printed. ${formatCurrency(-totalVariance, { currencyCode })} less than this order has unbilled.`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='lg'>
        <DialogHeader>
          <DialogTitle>Add bill</DialogTitle>
          <DialogDescription>
            Transcribe the supplier's invoice exactly as it reads. The amounts are not derived from
            the order.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
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

          {!vendorRecordId && (
            <p className='text-destructive text-sm'>
              This purchase order has no vendor, and a bill must have one. Set the vendor on the
              order first.
            </p>
          )}

          <FieldPanel
            orientation='responsive'
            breakpoint='md'
            resizeId='create-bill-from-po'
            defaultLabelWidth={110}
            className='p-0'>
            {/* Context, not questions: you pressed Add bill from this order. */}
            <FieldPanelRow title='Vendor' type={BaseType.STRING} showIcon>
              {vendorRecordId ? (
                <RecordBadge recordId={vendorRecordId} className='mt-1.5' />
              ) : (
                <span className='text-muted-foreground text-sm'>—</span>
              )}
            </FieldPanelRow>
            <FieldPanelRow title='Purchase order' type={BaseType.STRING} showIcon>
              <RecordBadge recordId={purchaseOrderRecordId} className='mt-1.5' />
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
                onChange={(val) => change('number', (val as string) ?? '')}
                placeholder='e.g. INV-88213'
                disabled={isPending}
              />
            </FieldPanelRow>

            <FieldPanelRow title='Bill date' type={BaseType.DATE} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.DATETIME}
                value={draft.billedAt}
                onChange={(val) => change('billedAt', (val as string) ?? null)}
                disabled={isPending}
                triggerProps={{ className: 'ps-0' }}
              />
            </FieldPanelRow>
            <FieldPanelRow title='Due date' type={BaseType.DATE} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.DATETIME}
                value={draft.dueAt}
                onChange={(val) => change('dueAt', (val as string) ?? null)}
                disabled={isPending}
                triggerProps={{ className: 'ps-0' }}
              />
            </FieldPanelRow>

            <FieldPanelRow title='Subtotal' type={BaseType.NUMBER} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.CURRENCY}
                fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                value={draft.subtotal}
                onChange={(val) => change('subtotal', val as number | null)}
                disabled={isPending}
                triggerProps={{ className: 'ps-0' }}
              />
            </FieldPanelRow>
            <FieldPanelRow title='Shipping' type={BaseType.NUMBER} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.CURRENCY}
                fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                value={draft.shippingTotal}
                onChange={(val) => change('shippingTotal', val as number | null)}
                disabled={isPending}
                triggerProps={{ className: 'ps-0' }}
              />
            </FieldPanelRow>
            <FieldPanelRow title='Tax' type={BaseType.NUMBER} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.CURRENCY}
                fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                value={draft.taxTotal}
                onChange={(val) => change('taxTotal', val as number | null)}
                disabled={isPending}
                triggerProps={{ className: 'ps-0' }}
              />
            </FieldPanelRow>
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
                onChange={(val) => change('total', val as number | null)}
                disabled={isPending}
                triggerProps={{ className: 'ps-0' }}
              />
            </FieldPanelRow>
          </FieldPanel>

          {/* Structure, not transcription. The lines arrive carrying the part, the
              description, the GRNI code and the match key — and NO quantity or
              price, because those two are what `matchBill` weighs. See
              `bill-lines-from-purchase-order.ts`. */}
          {billableLines.length > 0 && (
            <label className='mt-3 flex cursor-pointer items-start gap-2 px-1 text-sm'>
              <Checkbox
                checked={addLines}
                onCheckedChange={(next) => setAddLines(next === true)}
                disabled={isPending}
                className='mt-0.5'
              />
              <span>
                <span className='text-foreground'>
                  Add {billableLines.length} line
                  {billableLines.length === 1 ? '' : 's'} from the order
                </span>
                <span className='block text-muted-foreground text-xs'>
                  Part, description and account are filled in. Quantity and price stay empty for you
                  to enter from the invoice.
                </span>
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText='Adding...'
            disabled={!billDefId || !vendorRecordId}
            data-dialog-submit>
            Add bill
            <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
