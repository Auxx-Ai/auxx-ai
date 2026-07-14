// apps/web/src/components/money/ui/public-document/public-document-totals.tsx

// Shared totals block for public documents (quote acceptance, invoice pay) — translucent dark
// styling.

import { formatCurrency } from '~/components/money/ui/line-builder/shared'

export interface PublicDocumentTotalsRow {
  label: string
  /** Integer cents. */
  value: number
  /** Bold + brighter text — the invoice document's "Balance due" row. */
  emphasize?: boolean
}

interface PublicDocumentTotalsProps {
  currency: string
  /** Integer cents. */
  subtotal: number
  /** Integer cents. */
  discountAmount: number
  taxName: string | null
  taxRate: number | null
  /** Integer cents. */
  taxTotal: number
  /** Integer cents. */
  total: number
  /** Extra rows rendered after Total — e.g. invoice's Amount paid / Balance due. */
  footerRows?: PublicDocumentTotalsRow[]
}

export function PublicDocumentTotals({
  currency,
  subtotal,
  discountAmount,
  taxName,
  taxRate,
  taxTotal,
  total,
  footerRows,
}: PublicDocumentTotalsProps) {
  return (
    <div className='mt-4 ml-auto flex w-full max-w-xs flex-col gap-1 text-sm'>
      <div className='flex justify-between'>
        <span className='text-white/50'>Subtotal</span>
        <span className='tabular-nums text-white/80'>{formatCurrency(subtotal, currency)}</span>
      </div>
      {discountAmount > 0 ? (
        <div className='flex justify-between'>
          <span className='text-white/50'>Discount</span>
          <span className='tabular-nums text-white/80'>
            -{formatCurrency(discountAmount, currency)}
          </span>
        </div>
      ) : null}
      {taxTotal > 0 ? (
        <div className='flex justify-between'>
          <span className='text-white/50'>
            {taxName || 'Tax'}
            {taxRate ? ` (${taxRate}%)` : ''}
          </span>
          <span className='tabular-nums text-white/80'>{formatCurrency(taxTotal, currency)}</span>
        </div>
      ) : null}
      <div className='flex justify-between border-white/10 border-t pt-1 font-medium text-white/90'>
        <span>Total</span>
        <span className='tabular-nums'>{formatCurrency(total, currency)}</span>
      </div>
      {footerRows?.map((row) => (
        <div key={row.label} className='flex justify-between'>
          <span className={row.emphasize ? 'font-semibold text-white/90' : 'text-white/50'}>
            {row.label}
          </span>
          <span
            className={
              row.emphasize
                ? 'tabular-nums font-semibold text-white/90'
                : 'tabular-nums text-white/80'
            }>
            {formatCurrency(row.value, currency)}
          </span>
        </div>
      ))}
    </div>
  )
}
