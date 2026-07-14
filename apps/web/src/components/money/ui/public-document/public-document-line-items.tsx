// apps/web/src/components/money/ui/public-document/public-document-line-items.tsx

// Shared line-items table for public documents (quote acceptance, invoice pay) — translucent
// dark styling, horizontally scrollable on mobile inside its own overflow container.

import { formatCurrency } from '~/components/money/ui/line-builder/shared'

/** One rendered line — decoupled from `@auxx/lib/money`'s payload types on purpose so this
 * presentational component never needs a server-only import. */
export interface PublicDocumentLine {
  name: string
  qty: number
  unitPrice: number | null
  lineTotal: number | null
}

interface PublicDocumentLineItemsProps {
  lines: PublicDocumentLine[]
  currency: string
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
          {lines.map((line, i) => (
            <tr key={i} className='border-white/10 border-b text-white/80 last:border-0'>
              <td className='py-2 pr-2'>{line.name}</td>
              <td className='py-2 text-right tabular-nums'>{line.qty}</td>
              <td className='py-2 text-right tabular-nums'>
                {formatCurrency(line.unitPrice, currency)}
              </td>
              <td className='py-2 text-right tabular-nums'>
                {formatCurrency(line.lineTotal, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
