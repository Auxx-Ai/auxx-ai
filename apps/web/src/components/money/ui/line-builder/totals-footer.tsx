// apps/web/src/components/money/ui/line-builder/totals-footer.tsx

'use client'

// Totals footer for the line builder: subtotal → discount → tax → total. It shows the
// header's stored mirrors (the server recomputes them on every line write and realtime
// refreshes them), so a draft row counts once it is committed. `LineBuilder` owns the
// fetch and the writes; this renders and edits the header's own inputs.

import {
  type Line,
  type LineDocumentType,
  lineKindFor,
} from '@auxx/lib/accounting/documents/lines/client'
import { computeLineTotal, type DiscountType } from '@auxx/lib/accounting/sales/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo, useState } from 'react'
import { formatCurrency } from './shared'

/** Org tax rate preset (`documents.taxRates` setting, §G.1). */
export interface TaxRatePreset {
  id: string
  name: string
  rate: number
  isDefault?: boolean
}

interface DisplayTotals {
  subtotal: number
  discountAmount: number
  taxTotal: number
  total: number
}

/**
 * Σ the committed lines' amounts as the rows show them: the stored amount where the kind
 * stores one, `qty × rate` elsewhere. Unselected optional lines count nothing.
 */
function lineAmountSum(lines: readonly Line[], storesAmount: boolean): number {
  return lines.reduce((sum, line) => {
    if (line.optional === true && line.optionalSelected === false) return sum
    const amount = storesAmount ? line.lineTotal : computeLineTotal(line.qty ?? 1, line.unitPrice)
    return sum + (amount ?? 0)
  }, 0)
}

export function TotalsFooter({
  documentType,
  readOnly,
  amountsReadOnly,
  currencyCode,
  lines,
  billingValues,
  taxRates,
  onUpdateDiscount,
  onUpdateTax,
  onUpdateStatedAmount,
}: {
  documentType: LineDocumentType
  readOnly: boolean
  /** The lock on a `stored` document's typed headers. Defaults to {@link readOnly} (73 U3). */
  amountsReadOnly?: boolean
  currencyCode: string
  /** The committed lines, from the builder's `lines.list` cache. */
  lines: readonly Line[]
  /** The header's billing inputs and totals mirrors (`LineKind.billingAttrs`). */
  billingValues: Record<string, unknown>
  taxRates: TaxRatePreset[]
  onUpdateDiscount: (type: DiscountType | null, value: number | null) => void
  onUpdateTax: (name: string | null, rate: number | null) => void
  /** `stated` / `stored` only: write one of the header's own amounts, in minor units. */
  onUpdateStatedAmount: (attribute: string, cents: number | null) => void
}) {
  const kind = lineKindFor(documentType)
  const { totalsMode, billingPrefix: prefix } = kind
  /** Discount + tax are editable only where the document computes its own totals. */
  const editableBilling = totalsMode === 'computed'
  const showPaymentMirrors = kind.capabilities.paymentMirrors
  const lineSum = useMemo(
    () => lineAmountSum(lines, kind.amountMode === 'stored'),
    [lines, kind.amountMode]
  )
  const [discountDraft, setDiscountDraft] = useState<string | null>(null)

  const discountType =
    (billingValues[`${prefix}_discount_type`] as DiscountType | null | undefined) ?? null
  const discountValue =
    (billingValues[`${prefix}_discount_value`] as number | null | undefined) ?? null
  const taxName = (billingValues[`${prefix}_tax_name`] as string | null | undefined) ?? null
  const taxRate = (billingValues[`${prefix}_tax_rate`] as number | null | undefined) ?? null
  // Invoice-only ledger mirrors (§E.4), never written from here.
  const amountPaid = showPaymentMirrors
    ? ((billingValues.invoice_amount_paid as number | null | undefined) ?? 0)
    : null
  const balance = showPaymentMirrors
    ? ((billingValues.invoice_balance as number | null | undefined) ?? null)
    : null

  const stored = (key: string): number =>
    (billingValues[`${prefix}_${key}`] as number | null | undefined) ?? 0
  const statedDiscount = stored('discount_value')
  const statedShipping = stored('shipping_total')
  const statedTax = stored('tax_total')
  let totals: DisplayTotals
  if (totalsMode === 'computed') {
    // An order stores its subtotal net of the allocated discount (29 §2.3); show the gross.
    const subtotal = documentType === 'order' ? lineSum : stored('subtotal')
    const total = stored('total')
    totals = {
      subtotal,
      discountAmount: Math.max(0, subtotal + statedTax + statedShipping - total),
      taxTotal: statedTax,
      total,
    }
  } else if (totalsMode === 'stored') {
    totals = {
      subtotal: stored('subtotal'),
      discountAmount: stored('discount'),
      taxTotal: stored('tax_total'),
      total: stored('total'),
    }
  } else if (totalsMode === 'stated') {
    totals = {
      subtotal: stored('subtotal'),
      discountAmount: statedDiscount,
      taxTotal: statedTax,
      total: stored('total'),
    }
  } else {
    // A work order stores no totals.
    totals = { subtotal: lineSum, discountAmount: 0, taxTotal: 0, total: lineSum }
  }

  // A credit memo's stored headers are hook-written, so they stay text whatever the lock says.
  const headersReadOnly = !kind.headerAmountsTyped || (amountsReadOnly ?? readOnly)
  // Σ line totals + shipping + tax − discount = total (73 §5.2); a hint only.
  const tieDifference =
    totalsMode === 'stored'
      ? totals.total -
        (lineSum + stored('shipping_total') + totals.taxTotal - totals.discountAmount)
      : 0

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
          {totalsMode === 'stored' ? (
            <>
              <StatedAmountRow
                label='Subtotal'
                cents={totals.subtotal}
                readOnly={headersReadOnly}
                currencyCode={currencyCode}
                onCommit={(next) => onUpdateStatedAmount('subtotal', next)}
              />
              {kind.headerAmountsTyped && lineSum !== totals.subtotal && (
                <Hint>Lines add up to {formatCurrency(lineSum, currencyCode)}</Hint>
              )}
            </>
          ) : (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground'>Subtotal</span>
              <span className='tabular-nums'>{formatCurrency(totals.subtotal, currencyCode)}</span>
            </div>
          )}

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

          {/* An order's shipping is folded into its stored total; edited on the order. */}
          {editableBilling && statedShipping !== 0 && (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground'>Shipping</span>
              <span className='tabular-nums'>{formatCurrency(statedShipping, currencyCode)}</span>
            </div>
          )}

          {/* `stored` (vendor bill, credit memo): the vendor's own arithmetic,
              transcribed and never computed — but TYPED here, because this footer
              is the only surface any of these fields has (73 D5). "Transcribed"
              was read as "not editable"; it means "not recomputed". */}
          {totalsMode === 'stored' && (
            <>
              {/* A credit memo is `stored` too and has no shipping field, so the
                  row is keyed on the attribute being one the kind reads. */}
              {kind.billingAttrs.includes(`${prefix}_shipping_total`) && (
                <StatedAmountRow
                  label='Shipping'
                  cents={stored('shipping_total')}
                  readOnly={headersReadOnly}
                  currencyCode={currencyCode}
                  onCommit={(next) => onUpdateStatedAmount('shipping_total', next)}
                />
              )}
              <StatedAmountRow
                label='Tax'
                cents={totals.taxTotal}
                readOnly={headersReadOnly}
                currencyCode={currencyCode}
                onCommit={(next) => onUpdateStatedAmount('tax_total', next)}
              />
              {kind.billingAttrs.includes(`${prefix}_discount`) && (
                <StatedAmountRow
                  label='Discount'
                  cents={totals.discountAmount}
                  negative
                  readOnly={headersReadOnly}
                  currencyCode={currencyCode}
                  onCommit={(next) => onUpdateStatedAmount('discount', next)}
                />
              )}
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

          {totalsMode === 'stored' ? (
            <div className='border-primary-200/50 border-t pt-1 font-medium dark:border-[#1e2227]'>
              <StatedAmountRow
                label='Total'
                cents={totals.total}
                readOnly={headersReadOnly}
                currencyCode={currencyCode}
                onCommit={(next) => onUpdateStatedAmount('total', next)}
              />
              {/* The same arithmetic Post refuses on (73 §5.2), shown while the
                  paper is still in hand. */}
              {kind.headerAmountsTyped && tieDifference !== 0 && (
                <Hint>
                  Lines, shipping, tax and discount are{' '}
                  {formatCurrency(Math.abs(tieDifference), currencyCode)}{' '}
                  {tieDifference > 0 ? 'under' : 'over'} the total
                </Hint>
              )}
            </div>
          ) : (
            <div className='flex items-center justify-between border-primary-200/50 border-t pt-1 font-medium dark:border-[#1e2227]'>
              <span>Total</span>
              <span className='tabular-nums'>{formatCurrency(totals.total, currencyCode)}</span>
            </div>
          )}

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

/** A read-only note under an amount row. Computes nothing that is written. */
function Hint({ children }: { children: React.ReactNode }) {
  return <div className='text-right text-muted-foreground text-xs'>{children}</div>
}

/**
 * One editable amount row in a `stated` or `stored` footer — the document's own
 * discount / shipping / tax / subtotal / total mirror.
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
