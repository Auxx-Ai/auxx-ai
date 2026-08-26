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
import { DOCUMENT_KNOBS, type DocumentType } from './line-values'
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
function useLinesForTotals(lineRecordIds: RecordId[], draftLines: DraftLine[]): LineForTotals[] {
  const systemAttributeMap = useResourceStore((s) => s.systemAttributeMap)
  const qtyRef = systemAttributeMap.line_item_qty
  const priceRef = systemAttributeMap.line_item_unit_price
  const taxableRef = systemAttributeMap.line_item_taxable
  const optionalRef = systemAttributeMap.line_item_optional
  const optionalSelectedRef = systemAttributeMap.line_item_optional_selected

  const keys = useMemo(() => {
    if (!qtyRef || !priceRef || !taxableRef || !optionalRef || !optionalSelectedRef) return []
    return lineRecordIds.map((recordId) => ({
      qty: buildFieldValueKey(recordId, qtyRef),
      price: buildFieldValueKey(recordId, priceRef),
      taxable: buildFieldValueKey(recordId, taxableRef),
      optional: buildFieldValueKey(recordId, optionalRef),
      optionalSelected: buildFieldValueKey(recordId, optionalSelectedRef),
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
            result[k.taxable] = state.values[k.taxable]
            result[k.optional] = state.values[k.optional]
            result[k.optionalSelected] = state.values[k.optionalSelected]
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
        const taxable = scalar(storeValues[k.taxable], FieldType.CHECKBOX) !== false
        const optional = scalar(storeValues[k.optional], FieldType.CHECKBOX) === true
        const optionalSelected =
          scalar(storeValues[k.optionalSelected], FieldType.CHECKBOX) !== false
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
}) {
  const isQuote = documentType === 'quote'
  const isInvoice = documentType === 'invoice'
  // All THREE totalled documents mirror the same billing shape (discount/tax) onto their
  // own systemAttribute prefix (money MI1 build spec §J.2, widened to `order` by
  // plans/products/08-order-build.md §5.6) — work_order (M2 job view) has none.
  // Keyed lookups, not `isInvoice ? 'invoice' : 'quote'`: that shape reads an order's
  // totals off `quote_*` and shows the wrong numbers.
  const hasBilling = DOCUMENT_KNOBS[documentType].hasBilling
  const prefix = DOCUMENT_KNOBS[documentType].billingPrefix
  const lines = useLinesForTotals(lineRecordIds, draftLines)
  const [discountDraft, setDiscountDraft] = useState<string | null>(null)

  const discountType =
    (billingValues[`${prefix}_discount_type`] as DiscountType | null | undefined) ?? null
  const discountValue =
    (billingValues[`${prefix}_discount_value`] as number | null | undefined) ?? null
  const taxName = (billingValues[`${prefix}_tax_name`] as string | null | undefined) ?? null
  const taxRate = (billingValues[`${prefix}_tax_rate`] as number | null | undefined) ?? null
  // Invoice-only: the ledger-sync mirrors (§E.4) — never written from here, read-only.
  const amountPaid = isInvoice
    ? ((billingValues.invoice_amount_paid as number | null | undefined) ?? 0)
    : null
  const balance = isInvoice
    ? ((billingValues.invoice_balance as number | null | undefined) ?? null)
    : null

  const billing: DocumentBillingInputs = hasBilling ? { discountType, discountValue, taxRate } : {}
  const totals = computeDocumentTotals(lines, billing)

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

          {hasBilling && (
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

          {hasBilling && (
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

          <div className='flex items-center justify-between border-primary-200/50 border-t pt-1 font-medium dark:border-[#1e2227]'>
            <span>Total</span>
            <span className='tabular-nums'>{formatCurrency(totals.total, currencyCode)}</span>
          </div>

          {/* Invoice-only: the ledger-sync mirrors (money MI1 build spec §J.2) — read-only,
              never written from the footer (recording/deleting a payment is the only writer). */}
          {isInvoice && (
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
