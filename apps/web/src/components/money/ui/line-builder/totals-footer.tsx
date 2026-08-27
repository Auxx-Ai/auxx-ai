// apps/web/src/components/money/ui/line-builder/totals-footer.tsx

'use client'

// Totals footer for the line builder (money MQ1 build spec §H.1): subtotal →
// discount → tax → total (the add-line row lives in the builder itself).
// All amounts are computed client-side with `computeDocumentTotals` from
// `@auxx/lib/money/client` over the same optimistic field-value store the
// editors write to. `LineBuilder` owns fetching and mutations; this footer is
// a passive aggregate subscriber plus totals UI.

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeValue } from '@auxx/database/types'
import { formatToRawValue } from '@auxx/lib/field-values/client'
import {
  computeDocumentTotals,
  computeLineTotal,
  type DiscountType,
  type DocumentBillingInputs,
  type DocumentTotals,
  type LineForTotals,
} from '@auxx/lib/money/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RecordId } from '~/components/resources'
import {
  buildFieldValueKey,
  type CustomFieldValueState,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import type { DraftLine } from './line-rows'
import { type DocumentType, type LineSchema, lineSchemaFor } from './line-values'
import { formatCurrency } from './shared'

/** Org tax rate preset (`documents.taxRates` setting, §G.1). */
export interface TaxRatePreset {
  id: string
  name: string
  rate: number
  isDefault?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Totals data — all lines' qty/unitPrice/taxable, reactively from the store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subscribe to every REAL line's qty/unitPrice/taxable/optional/optionalSelected and shape
 * them as `LineForTotals[]`, then append local phantom draft lines' equivalent values
 * (`draftLines` — pure client state, no store fetch needed) so the optimistic footer counts
 * in-progress rows too. `LineBuilder` preloads these keys; the footer only subscribes.
 */
function useLinesForTotals(
  lineRecordIds: RecordId[],
  draftLines: DraftLine[],
  schema: LineSchema
): LineForTotals[] {
  const systemAttributeMap = useResourceStore((s) => s.systemAttributeMap)
  // An attribute the schema maps to `null` has no field to resolve, so its key is
  // `undefined` and the reader below falls back to the default.
  //
  // 🛑 Only qty and price may hard-gate. This used to bail to `[]` unless ALL FIVE
  // resolved, which on a document whose lines carry no `taxable`/`optional` fields
  // (every purchasing line) would silently total the whole document to zero.
  const ref = (key: keyof typeof schema.attrs) => {
    const attr = schema.attrs[key]
    return attr ? systemAttributeMap[attr] : undefined
  }
  const qtyRef = ref('qty')
  const priceRef = ref('unitPriceCents')
  const taxableRef = ref('taxable')
  const optionalRef = ref('optional')
  const optionalSelectedRef = ref('optionalSelected')

  const keys = useMemo(() => {
    if (!qtyRef || !priceRef) return []
    return lineRecordIds.map((recordId) => ({
      qty: buildFieldValueKey(recordId, qtyRef),
      price: buildFieldValueKey(recordId, priceRef),
      taxable: taxableRef ? buildFieldValueKey(recordId, taxableRef) : null,
      optional: optionalRef ? buildFieldValueKey(recordId, optionalRef) : null,
      optionalSelected: optionalSelectedRef
        ? buildFieldValueKey(recordId, optionalSelectedRef)
        : null,
    }))
  }, [lineRecordIds, qtyRef, priceRef, taxableRef, optionalRef, optionalSelectedRef])
  const keysKey = keys.map((k) => k.qty).join(',')

  const storeValues = useFieldValueStore(
    useShallow(
      // biome-ignore lint/correctness/useExhaustiveDependencies: keys is captured from the same render as keysKey; keysKey is the stable content key
      useCallback(
        (state: CustomFieldValueState) => {
          const result: Record<string, unknown> = {}
          for (const k of keys) {
            result[k.qty] = state.values[k.qty]
            result[k.price] = state.values[k.price]
            if (k.taxable) result[k.taxable] = state.values[k.taxable]
            if (k.optional) result[k.optional] = state.values[k.optional]
            if (k.optionalSelected) result[k.optionalSelected] = state.values[k.optionalSelected]
          }
          return result
        },
        [keysKey]
      )
    )
  )

  const realLines = useMemo(
    () =>
      keys.map((k) => {
        // formatToRawValue returns arrays for array-stored values — collapse to
        // the scalar (the same treatment useSystemValues applies).
        const scalar = (raw: unknown, fieldType: FieldTypeValue): unknown => {
          if (raw === undefined) return undefined
          const formatted = formatToRawValue(raw, fieldType)
          return Array.isArray(formatted) ? formatted[0] : formatted
        }
        const qty = (scalar(storeValues[k.qty], FieldType.NUMBER) as number | null | undefined) ?? 1
        const unitPrice =
          (scalar(storeValues[k.price], FieldType.CURRENCY) as number | null | undefined) ?? null
        // Absent field -> the neutral default: taxable, not optional, selected.
        // That is what makes `computeDocumentTotals` (which takes all four) correct
        // for a document carrying none of them.
        const taxable = k.taxable
          ? scalar(storeValues[k.taxable], FieldType.CHECKBOX) !== false
          : true
        const optional = k.optional
          ? scalar(storeValues[k.optional], FieldType.CHECKBOX) === true
          : false
        const optionalSelected = k.optionalSelected
          ? scalar(storeValues[k.optionalSelected], FieldType.CHECKBOX) !== false
          : true
        return { lineTotal: computeLineTotal(qty, unitPrice), taxable, optional, optionalSelected }
      }),
    [keys, storeValues]
  )

  const draftLinesForTotals = useMemo(
    () =>
      draftLines.map((draft) => ({
        lineTotal: computeLineTotal(draft.qty, draft.unitPriceCents),
        taxable: draft.taxable,
        optional: draft.optional,
        optionalSelected: draft.optionalSelected,
      })),
    [draftLines]
  )

  return useMemo(() => [...realLines, ...draftLinesForTotals], [realLines, draftLinesForTotals])
}

// ─────────────────────────────────────────────────────────────────────────────
// Totals footer
// ─────────────────────────────────────────────────────────────────────────────

export function TotalsFooter({
  documentType,
  readOnly,
  currencyCode,
  lineRecordIds,
  draftLines,
  billingValues,
  taxRates,
  onUpdateDiscount,
  onUpdateTax,
  onUpdateStatedAmount,
}: {
  documentType: DocumentType
  readOnly: boolean
  currencyCode: string
  lineRecordIds: RecordId[]
  /** Local phantom draft lines not yet persisted — counted optimistically (money plan 18 §3). */
  draftLines: DraftLine[]
  /** Parent-document billing values fetched once by `LineBuilder`. */
  billingValues: Record<string, unknown>
  taxRates: TaxRatePreset[]
  onUpdateDiscount: (type: DiscountType | null, value: number | null) => void
  onUpdateTax: (name: string | null, rate: number | null) => void
  /**
   * `stated` only — writes one of the document's own amount mirrors by attribute
   * suffix (`discount_value` / `shipping_total` / `tax_total`), in integer minor
   * units. See `updateStatedAmount` in `line-builder.tsx` for why these must be
   * writable at all.
   */
  onUpdateStatedAmount: (attribute: string, cents: number | null) => void
}) {
  const schema = lineSchemaFor(documentType)
  const { totalsMode, billingPrefix: prefix } = schema
  /** Discount + tax are editable only where the document computes its own totals. */
  const editableBilling = totalsMode === 'computed'
  const showPaymentMirrors = schema.capabilities.paymentMirrors
  // All THREE totalled documents mirror the same billing shape (discount/tax) onto their
  // own systemAttribute prefix (money MI1 build spec §J.2, widened to `order` by
  // plans/products/08-order-build.md §5.6) — work_order (M2 job view) has none.
  // Keyed lookups, not `isInvoice ? 'invoice' : 'quote'`: that shape reads an order's
  // totals off `quote_*` and shows the wrong numbers.
  const lines = useLinesForTotals(lineRecordIds, draftLines, schema)
  const [discountDraft, setDiscountDraft] = useState<string | null>(null)

  const discountType =
    (billingValues[`${prefix}_discount_type`] as DiscountType | null | undefined) ?? null
  const discountValue =
    (billingValues[`${prefix}_discount_value`] as number | null | undefined) ?? null
  const taxName = (billingValues[`${prefix}_tax_name`] as string | null | undefined) ?? null
  const taxRate = (billingValues[`${prefix}_tax_rate`] as number | null | undefined) ?? null
  // Invoice-only: the ledger-sync mirrors (§E.4) — never written from here, read-only.
  const amountPaid = showPaymentMirrors
    ? ((billingValues.invoice_amount_paid as number | null | undefined) ?? 0)
    : null
  const balance = showPaymentMirrors
    ? ((billingValues.invoice_balance as number | null | undefined) ?? null)
    : null

  const billing: DocumentBillingInputs = editableBilling
    ? { discountType, discountValue, taxRate }
    : {}
  const computed = computeDocumentTotals(lines, billing)
  // 🛑 `stored` reads the mirrors and computes NOTHING. A vendor bill's totals are
  // transcribed from the vendor's paper, and recomputing them from the lines would
  // silently correct the vendor's own arithmetic — the exact discrepancy the
  // three-way match exists to surface (plans/purchasing/01-build-plan.md §5.4b).
  const stored = (key: string): number =>
    (billingValues[`${prefix}_${key}`] as number | null | undefined) ?? 0
  // Stated amounts, read for `stated` mode only. A PO's shipping and tax are keyed
  // or produced by the freight allocation, never derived from a rate.
  const statedDiscount = stored('discount_value')
  const statedShipping = stored('shipping_total')
  const statedTax = stored('tax_total')
  let totals: DocumentTotals = computed
  if (totalsMode === 'stored') {
    totals = {
      subtotal: stored('subtotal'),
      // No discount row is rendered in `stored` mode, so this is never read;
      // it exists to satisfy the shared shape rather than to mean anything.
      discountAmount: 0,
      taxTotal: stored('tax_total'),
      total: stored('total'),
    }
  } else if (totalsMode === 'stated') {
    // 🛑 Must match what the server persists: subtotal − discount + shipping + tax
    // (plans/purchasing/01-build-plan.md §4.1). `computed.subtotal` is the line sum;
    // `computed.total` is NOT usable here because it applies a rate this document
    // does not have.
    totals = {
      subtotal: computed.subtotal,
      discountAmount: statedDiscount,
      taxTotal: statedTax,
      total: computed.subtotal - statedDiscount + statedShipping + statedTax,
    }
  }

  const selectedTaxId =
    taxRate !== null
      ? (taxRates.find((r) => r.rate === taxRate && r.name === taxName)?.id ?? '__custom__')
      : '__none__'

  const writeDiscount = (type: DiscountType | null, value: number | null) => {
    onUpdateDiscount(type, value)
  }

  const writeTax = (preset: TaxRatePreset | null) => {
    // Snapshot name+rate at pick — editing a preset later never rewrites documents.
    onUpdateTax(preset?.name ?? null, preset?.rate ?? null)
  }

  // Amount discounts are stored as integer cents (CURRENCY convention); percent
  // discounts as plain percentages. The input always shows/accepts the display
  // unit (dollars or percent).
  const discountDisplayValue =
    discountValue === null
      ? ''
      : String(discountType === 'amount' ? discountValue / 100 : discountValue)

  const commitDiscountValue = () => {
    if (discountDraft === null) return
    const trimmed = discountDraft.trim()
    setDiscountDraft(null)
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed !== null && Number.isNaN(parsed)) return
    const type = parsed === null ? null : (discountType ?? 'percent')
    writeDiscount(type, parsed !== null && type === 'amount' ? Math.round(parsed * 100) : parsed)
  }

  // Type toggle keeps the number the user SEES stable: 10% becomes $10 (1000¢).
  const toggleDiscountType = (type: DiscountType) => {
    if (discountValue === null) {
      writeDiscount(type, null)
      return
    }
    const displayed = discountType === 'amount' ? discountValue / 100 : discountValue
    writeDiscount(type, type === 'amount' ? Math.round(displayed * 100) : displayed)
  }

  return (
    <div className='flex flex-col'>
      {/* Totals block */}
      <div className='flex justify-end px-4 py-2'>
        <div className='w-full max-w-xs space-y-1 text-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground'>Subtotal</span>
            <span className='tabular-nums'>{formatCurrency(totals.subtotal, currencyCode)}</span>
          </div>

          {editableBilling && (
            <div className='flex items-center justify-between gap-2'>
              <div className='flex items-center gap-1'>
                <span className='text-muted-foreground'>Discount</span>
                {!readOnly && (
                  <div className='flex overflow-hidden rounded-md border border-primary-200/60 dark:border-[#2c313a]'>
                    {(['percent', 'amount'] as const).map((type) => (
                      <button
                        key={type}
                        type='button'
                        onClick={() => toggleDiscountType(type)}
                        className={cn(
                          'px-1.5 py-0.5 text-[10px] leading-none',
                          (discountType ?? 'percent') === type
                            ? 'bg-primary-150 text-foreground dark:bg-primary-100'
                            : 'text-muted-foreground hover:bg-primary-100/60'
                        )}>
                        {type === 'percent' ? '%' : '$'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className='flex items-center gap-1'>
                {readOnly ? (
                  <span className='tabular-nums'>
                    {totals.discountAmount > 0
                      ? `-${formatCurrency(totals.discountAmount, currencyCode)}`
                      : '—'}
                  </span>
                ) : (
                  <>
                    <input
                      value={discountDraft ?? discountDisplayValue}
                      onChange={(e) => setDiscountDraft(e.target.value)}
                      onBlur={commitDiscountValue}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setDiscountDraft(null)
                      }}
                      inputMode='decimal'
                      placeholder='0'
                      className='w-14 rounded-sm border-none bg-transparent px-1 text-right text-sm tabular-nums outline-none hover:bg-primary-100/60 focus:bg-primary-100/80'
                    />
                    <span className='w-20 text-right text-muted-foreground text-xs tabular-nums'>
                      {totals.discountAmount > 0
                        ? `-${formatCurrency(totals.discountAmount, currencyCode)}`
                        : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {editableBilling && (
            <div className='flex items-center justify-between gap-2'>
              <div className='flex min-w-0 items-center gap-1'>
                <span className='text-muted-foreground'>Tax</span>
                {readOnly ? (
                  taxRate !== null && (
                    <span className='truncate text-muted-foreground text-xs'>
                      {taxName ?? 'Tax'} ({taxRate}%)
                    </span>
                  )
                ) : (
                  <Select
                    value={selectedTaxId}
                    onValueChange={(id) => {
                      if (id === '__none__') return writeTax(null)
                      const preset = taxRates.find((r) => r.id === id)
                      if (preset) writeTax(preset)
                    }}>
                    <SelectTrigger
                      size='xs'
                      className='w-auto min-w-24 border-none bg-transparent px-1 shadow-none hover:bg-primary-100/60'>
                      <SelectValue placeholder='No tax' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__none__'>No tax</SelectItem>
                      {taxRates.map((rate) => (
                        <SelectItem key={rate.id} value={rate.id}>
                          {rate.name} ({rate.rate}%)
                        </SelectItem>
                      ))}
                      {selectedTaxId === '__custom__' && (
                        <SelectItem value='__custom__'>
                          {taxName ?? 'Tax'} ({taxRate}%)
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <span className='tabular-nums'>{formatCurrency(totals.taxTotal, currencyCode)}</span>
            </div>
          )}

          {/* `stored` (vendor bill): the transcribed additions, displayed and
              never computed. Both rows were MISSING until the cutover — the
              footer showed a bill's subtotal and total with nothing between them,
              so a bill whose shipping and tax were entered simply did not add up
              on screen. `vendor_bill_shipping_total` had to join `billingAttrs`
              for this; the descriptor listed only subtotal/tax/total.
              🛑 READ-ONLY, unlike the `stated` rows below. A PO's shipping and tax
              are freight-allocation INPUTS typed off the carrier's invoice; a
              bill's are transcribed with the rest of the vendor's arithmetic. */}
          {totalsMode === 'stored' && (
            <>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>Shipping</span>
                <span className='tabular-nums'>
                  {formatCurrency(stored('shipping_total'), currencyCode)}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>Tax</span>
                <span className='tabular-nums'>
                  {formatCurrency(totals.taxTotal, currencyCode)}
                </span>
              </div>
            </>
          )}

          {/* `stated` (purchase order): amounts the document carries, not rates.
              🛑 EDITABLE — shipping and tax are the freight-allocation INPUTS
              (plans/purchasing/01-build-plan.md §4.1), typed by hand off the
              freight invoice, and `showInPanel: false` makes this footer the only
              place they can be entered at all. */}
          {totalsMode === 'stated' && (
            <>
              <StatedAmountRow
                label='Discount'
                cents={statedDiscount}
                negative
                readOnly={readOnly}
                currencyCode={currencyCode}
                onCommit={(next) => onUpdateStatedAmount('discount_value', next)}
              />
              <StatedAmountRow
                label='Shipping'
                cents={statedShipping}
                readOnly={readOnly}
                currencyCode={currencyCode}
                onCommit={(next) => onUpdateStatedAmount('shipping_total', next)}
              />
              <StatedAmountRow
                label='Tax'
                cents={statedTax}
                readOnly={readOnly}
                currencyCode={currencyCode}
                onCommit={(next) => onUpdateStatedAmount('tax_total', next)}
              />
            </>
          )}

          <div className='flex items-center justify-between border-primary-200/50 border-t pt-1 font-medium dark:border-[#1e2227]'>
            <span>Total</span>
            <span className='tabular-nums'>{formatCurrency(totals.total, currencyCode)}</span>
          </div>

          {/* Invoice-only: the ledger-sync mirrors (money MI1 build spec §J.2) — read-only,
              never written from the footer (recording/deleting a payment is the only writer). */}
          {showPaymentMirrors && (
            <>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>Amount paid</span>
                <span className='tabular-nums'>{formatCurrency(amountPaid, currencyCode)}</span>
              </div>
              <div className='flex items-center justify-between font-medium'>
                <span>Balance</span>
                <span className='tabular-nums'>{formatCurrency(balance, currencyCode)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * One editable amount row in a `stated` footer — the document's own
 * discount / shipping / tax mirror.
 *
 * Currency convention: the value is stored in integer minor units and the input
 * shows and accepts DOLLARS, matching the `amount` discount input above and
 * `PriceCellView` in the row grid. An unparseable entry restores the last
 * committed display rather than writing NaN; an empty one clears the field to
 * `null` (which the totals read back as 0).
 */
function StatedAmountRow({
  label,
  cents,
  negative = false,
  readOnly,
  currencyCode,
  onCommit,
}: {
  label: string
  cents: number
  /** Discount is subtracted, so it displays with a leading minus at rest. */
  negative?: boolean
  readOnly: boolean
  currencyCode: string
  onCommit: (cents: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = cents === 0 ? '' : String(cents / 100)

  const commit = () => {
    if (draft === null) return
    const trimmed = draft.trim()
    setDraft(null)
    if (!trimmed) {
      if (cents !== 0) onCommit(null)
      return
    }
    const parsed = Number(trimmed.replace(/[$,]/g, ''))
    if (!Number.isFinite(parsed)) return
    const next = Math.round(parsed * 100)
    if (next === cents) return
    onCommit(next)
  }

  const formatted = `${negative && cents > 0 ? '-' : ''}${formatCurrency(cents, currencyCode)}`

  if (readOnly) {
    return (
      <div className='flex items-center justify-between'>
        <span className='text-muted-foreground'>{label}</span>
        <span className='tabular-nums'>{formatted}</span>
      </div>
    )
  }

  return (
    <div className='flex items-center justify-between gap-2'>
      <span className='text-muted-foreground'>{label}</span>
      <div className='flex items-center gap-1'>
        <input
          value={draft ?? display}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setDraft(display)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setDraft(null)
          }}
          inputMode='decimal'
          placeholder='0'
          aria-label={label}
          className='w-14 rounded-sm border-none bg-transparent px-1 text-right text-sm tabular-nums outline-none hover:bg-primary-100/60 focus:bg-primary-100/80'
        />
        <span className='w-20 text-right text-muted-foreground text-xs tabular-nums'>
          {cents === 0 ? '' : formatted}
        </span>
      </div>
    </div>
  )
}
