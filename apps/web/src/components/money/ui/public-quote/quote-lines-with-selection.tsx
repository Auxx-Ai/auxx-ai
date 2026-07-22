// apps/web/src/components/money/ui/public-quote/quote-lines-with-selection.tsx
'use client'

// Client wrapper for the public quote page's line-items table + totals (money plan 18 §4).
// Required lines render exactly like the shared read-only `PublicDocumentLineItems`; optional
// lines get a real, unstyled `<input type="checkbox">` — NOT the shadcn `Checkbox` (that one
// wraps a Radix `button`, which can't carry `form`/`name`/`value` for native submission, see
// `@auxx/ui/components/checkbox`) — bound via `form="accept-form"` to the Accept form so a
// no-JS submit still carries selections (progressive enhancement, amendment 2). Toggling only
// updates local React state and recomputes the displayed totals with `computeDocumentTotals`
// from `@auxx/lib/money/client` — the same isomorphic function the line-builder footer uses —
// never a network call; nothing persists until the Accept POST (decision 3).

import {
  computeDocumentTotals,
  type DiscountType,
  formatLineItemUnit,
  type LineItemUnit,
} from '@auxx/lib/money/client'
import { cn } from '@auxx/ui/lib/utils'
import { Fragment, useMemo, useState } from 'react'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { PhotoGallery } from '~/components/money/ui/public-document/photo-gallery'
import { PublicDocumentTotals } from '~/components/money/ui/public-document/public-document-totals'

/** One quote line as the public page needs it — decoupled from `@auxx/lib/money`'s payload
 * types on purpose so this client component never statically imports a server-only module. */
export interface QuoteSelectionLine {
  lineInstanceId: string
  name: string
  qty: number
  unit?: LineItemUnit | null
  unitPrice: number | null
  lineTotal: number | null
  taxable: boolean
  optional: boolean
  /** Seller's pre-accept default (checked = "included unless removed", money plan 18 decision 2). */
  optionalSelected: boolean
  /** Site photos captured for this line (plan 37b §6) — already internal-filtered. */
  photos?: { ref: string; caption?: string }[]
}

interface QuoteLinesWithSelectionProps {
  lines: QuoteSelectionLine[]
  currency: string
  discountType: DiscountType | null
  discountValue: number | null
  taxName: string | null
  taxRate: number | null
  /** Disables the checkboxes once the quote is no longer awaiting a decision (approved,
   * declined, expired, or still being revised) — selections are locked at accept (decision 3),
   * so there's nothing left to toggle and no accept form in the DOM to submit into anyway. */
  readOnly?: boolean
  /** Base path of the token-scoped photo route (`/quote/{token}/photo`, plan 37b §6) — each
   * line's thumbnails point here. */
  photoBasePath: string
}

/** Formats a quantity without trailing zeros, up to 3 decimal places (`2.375`, `5`, `12`) —
 * mirrors the line-builder's compact quantity cell (money plan 13 §7 decimal rule). */
function formatQty(qty: number): string {
  return String(Number(qty.toFixed(3)))
}

export function QuoteLinesWithSelection({
  lines,
  currency,
  discountType,
  discountValue,
  taxName,
  taxRate,
  readOnly = false,
  photoBasePath,
}: QuoteLinesWithSelectionProps) {
  // Page-local selection state, seeded from each optional line's seller default. Keyed by line
  // instance id — untouched (required) lines never enter this map.
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      lines
        .filter((line) => line.optional)
        .map((line) => [line.lineInstanceId, line.optionalSelected])
    )
  )

  const isChecked = (line: QuoteSelectionLine): boolean =>
    line.optional ? (selected[line.lineInstanceId] ?? line.optionalSelected) : true

  const toggle = (lineInstanceId: string) => {
    setSelected((prev) => ({ ...prev, [lineInstanceId]: !prev[lineInstanceId] }))
  }

  const totals = useMemo(() => {
    const linesForTotals = lines.map((line) => ({
      lineTotal: line.lineTotal,
      taxable: line.taxable,
      optional: line.optional,
      optionalSelected: line.optional
        ? (selected[line.lineInstanceId] ?? line.optionalSelected)
        : undefined,
    }))
    return computeDocumentTotals(linesForTotals, { discountType, discountValue, taxRate })
  }, [lines, selected, discountType, discountValue, taxRate])

  return (
    <>
      <div className='mt-6 overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-white/10 border-b text-left text-white/50'>
              <th className='py-2 font-medium'>Description</th>
              <th className='py-2 text-right font-medium'>Qty</th>
              <th className='py-2 text-right font-medium'>Unit price</th>
              <th className='py-2 text-right font-medium'>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const unitSuffix = formatLineItemUnit(line.unit, 'document')
              const checked = isChecked(line)
              const hasPhotos = !!line.photos?.length
              return (
                <Fragment key={line.lineInstanceId}>
                  <tr
                    className={cn(
                      'border-white/10 border-b last:border-0',
                      line.optional ? 'text-white/60' : 'text-white/80',
                      hasPhotos && 'border-b-0'
                    )}>
                    <td className='py-2 pr-2'>
                      <div className='flex items-start gap-2'>
                        {line.optional ? (
                          <input
                            type='checkbox'
                            name='selectedLineIds'
                            value={line.lineInstanceId}
                            form='accept-form'
                            checked={checked}
                            disabled={readOnly}
                            onChange={() => toggle(line.lineInstanceId)}
                            aria-label={`Include ${line.name}`}
                            className='mt-0.5 h-4 w-4 shrink-0 rounded-sm border border-white/30 bg-transparent accent-white disabled:opacity-50'
                          />
                        ) : null}
                        <div>
                          <span>{line.name}</span>
                          {line.optional ? (
                            <span className='ml-2 inline-flex items-center gap-1 align-middle text-[10px] text-white/40 uppercase tracking-wide'>
                              <span className='rounded-full border border-white/20 px-1.5 py-0.5'>
                                Optional
                              </span>
                              {line.optionalSelected ? '(recommended)' : '(add-on)'}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className='py-2 text-right tabular-nums'>
                      {unitSuffix ? `${formatQty(line.qty)} ${unitSuffix}` : formatQty(line.qty)}
                    </td>
                    <td className='py-2 text-right tabular-nums'>
                      {unitSuffix && line.unitPrice !== null
                        ? `${formatCurrency(line.unitPrice, currency)}/${unitSuffix}`
                        : formatCurrency(line.unitPrice, currency)}
                    </td>
                    <td className='py-2 text-right tabular-nums'>
                      {formatCurrency(line.lineTotal, currency)}
                    </td>
                  </tr>
                  {hasPhotos ? (
                    <tr className='border-white/10 border-b last:border-0'>
                      <td colSpan={4} className='pb-3'>
                        <PhotoGallery
                          photos={line.photos ?? []}
                          photoBasePath={photoBasePath}
                          size='sm'
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <PublicDocumentTotals
        currency={currency}
        subtotal={totals.subtotal}
        discountAmount={totals.discountAmount}
        taxName={taxName}
        taxRate={taxRate}
        taxTotal={totals.taxTotal}
        total={totals.total}
      />
    </>
  )
}
