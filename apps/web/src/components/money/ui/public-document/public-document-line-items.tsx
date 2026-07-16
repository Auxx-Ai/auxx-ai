// apps/web/src/components/money/ui/public-document/public-document-line-items.tsx

// Shared line-items table for public documents (quote acceptance, invoice pay) — translucent
// dark styling, horizontally scrollable on mobile inside its own overflow container. Stays
// server/read-only for INVOICES; the quote page uses its own client selection wrapper
// (`public-quote/quote-lines-with-selection.tsx`, money plan 18 §4) instead of this component.

import { formatLineItemUnit, type LineItemUnit } from '@auxx/lib/money/client'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'

/** One rendered line — decoupled from `@auxx/lib/money`'s payload types on purpose so this
 * presentational component never needs a server-only import. */
export interface PublicDocumentLine {
  name: string
  qty: number
  /** Money plan 13 §1/§6 — `null`/absent renders exactly as an unitless line does today. */
  unit?: LineItemUnit | null
  unitPrice: number | null
  lineTotal: number | null
}

interface PublicDocumentLineItemsProps {
  lines: PublicDocumentLine[]
  currency: string
}

/** Formats a quantity without trailing zeros, up to 3 decimal places (`2.375`, `5`, `12`) —
 * mirrors the line-builder's compact quantity cell (money plan 13 §7 decimal rule). */
function formatQty(qty: number): string {
  return String(Number(qty.toFixed(3)))
}

export function PublicDocumentLineItems({ lines, currency }: PublicDocumentLineItemsProps) {
  return (
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
          {lines.map((line, i) => {
            const unitSuffix = formatLineItemUnit(line.unit, 'document')
            return (
              <tr key={i} className='border-white/10 border-b text-white/80 last:border-0'>
                <td className='py-2 pr-2'>{line.name}</td>
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
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
