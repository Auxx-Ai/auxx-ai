// apps/web/src/components/money/ui/public-invoice/public-invoice-document.tsx

// The branded public invoice document + Pay flow (money MP1 build spec §I). Server
// component — no client JS beyond the processing poller. The Pay button is a plain
// `<form method="post">` to `./checkout` (a route handler), so a click needs zero client
// JavaScript: Stripe Checkout is a full-page hosted redirect anyway.

import type { PublicInvoicePayload } from '@auxx/lib/money'
import { Button } from '@auxx/ui/components/button'
import { AlertCircle, Loader2 } from 'lucide-react'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { ProcessingPoller } from './processing-poller'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

interface PublicInvoiceDocumentProps {
  token: string
  payload: PublicInvoicePayload
  checkoutState: string | undefined
  checkoutError: string | undefined
}

export function PublicInvoiceDocument({
  token,
  payload,
  checkoutState,
  checkoutError,
}: PublicInvoiceDocumentProps) {
  const {
    number,
    status,
    issuedAt,
    dueDate,
    contact,
    lines,
    subtotal,
    discountAmount,
    taxName,
    taxRate,
    taxTotal,
    total,
    amountPaid,
    balance,
    currency,
    business,
    branding,
    paymentsEnabled,
    processingPayment,
  } = payload

  const isPaid = status === 'paid' || balance <= 0
  const isVoid = status === 'void'
  const showProcessing = processingPayment || (checkoutState === 'success' && !isPaid)
  const canPay = !showProcessing && !isPaid && !isVoid && paymentsEnabled && balance > 0

  return (
    <div className='flex min-h-screen flex-col items-center bg-muted/30 px-4 py-10 dark:bg-background sm:px-8'>
      <ProcessingPoller active={showProcessing} />
      <div className='w-full max-w-2xl rounded-lg border bg-background p-6 shadow-sm sm:p-10'>
        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <div className='flex items-start justify-between gap-4 border-b pb-6'>
          <div>
            {branding.logo ? (
              <img
                src={branding.logo.url}
                alt={business.companyName ?? 'Business logo'}
                className='mb-2 h-10 max-w-[180px] object-contain'
              />
            ) : null}
            <p className='font-semibold text-lg'>{business.companyName || 'Invoice'}</p>
            {business.email ? (
              <p className='text-muted-foreground text-sm'>{business.email}</p>
            ) : null}
            {business.phone ? (
              <p className='text-muted-foreground text-sm'>{business.phone}</p>
            ) : null}
          </div>
          <div className='text-right'>
            <p className='font-semibold text-lg'>Invoice {number}</p>
            <p className='text-muted-foreground text-sm'>Issued {formatDate(issuedAt)}</p>
            {dueDate ? (
              <p className='text-muted-foreground text-sm'>Due {formatDate(dueDate)}</p>
            ) : null}
          </div>
        </div>

        {/* ─── Billing party ──────────────────────────────────────────────── */}
        <div className='mt-6 flex flex-col gap-1'>
          <p className='text-muted-foreground text-xs uppercase tracking-wide'>Billed to</p>
          <p className='font-medium'>{contact.name || '—'}</p>
          {contact.email ? <p className='text-muted-foreground text-sm'>{contact.email}</p> : null}
        </div>

        {/* ─── Line items ─────────────────────────────────────────────────── */}
        <div className='mt-6 overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b text-left text-muted-foreground'>
                <th className='py-2 font-medium'>Description</th>
                <th className='py-2 text-right font-medium'>Qty</th>
                <th className='py-2 text-right font-medium'>Unit price</th>
                <th className='py-2 text-right font-medium'>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className='border-b last:border-0'>
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

        {/* ─── Totals ─────────────────────────────────────────────────────── */}
        <div className='mt-4 ml-auto flex w-full max-w-xs flex-col gap-1 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Subtotal</span>
            <span className='tabular-nums'>{formatCurrency(subtotal, currency)}</span>
          </div>
          {discountAmount > 0 ? (
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Discount</span>
              <span className='tabular-nums'>-{formatCurrency(discountAmount, currency)}</span>
            </div>
          ) : null}
          {taxTotal > 0 ? (
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>
                {taxName || 'Tax'}
                {taxRate ? ` (${taxRate}%)` : ''}
              </span>
              <span className='tabular-nums'>{formatCurrency(taxTotal, currency)}</span>
            </div>
          ) : null}
          <div className='flex justify-between border-t pt-1 font-medium'>
            <span>Total</span>
            <span className='tabular-nums'>{formatCurrency(total, currency)}</span>
          </div>
          {amountPaid > 0 ? (
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Amount paid</span>
              <span className='tabular-nums'>{formatCurrency(amountPaid, currency)}</span>
            </div>
          ) : null}
          <div className='flex justify-between font-semibold'>
            <span>Balance due</span>
            <span className='tabular-nums'>{formatCurrency(Math.max(balance, 0), currency)}</span>
          </div>
        </div>

        {/* ─── Payment state / action ─────────────────────────────────────── */}
        <div className='mt-8 border-t pt-6'>
          {checkoutError ? (
            <div className='mb-4 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm'>
              <AlertCircle className='size-4 shrink-0' />
              <span>Payment failed: {checkoutError}</span>
            </div>
          ) : null}

          {showProcessing ? (
            <div className='flex items-center gap-2 text-muted-foreground text-sm'>
              <Loader2 className='size-4 animate-spin' />
              <span>Payment processing… this page updates automatically.</span>
            </div>
          ) : isPaid ? (
            <p className='font-medium text-sm text-success'>Paid in full — thank you.</p>
          ) : canPay ? (
            <form method='post' action={`/pay/${token}/checkout`}>
              <Button type='submit' size='lg'>
                Pay {formatCurrency(balance, currency)}
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  )
}
