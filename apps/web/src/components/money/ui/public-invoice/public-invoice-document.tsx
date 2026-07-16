// apps/web/src/components/money/ui/public-invoice/public-invoice-document.tsx

// The branded public invoice document + Pay flow (money MP1 build spec §I), restyled onto the
// SimpleLayout dark ColorfulBg + translucent-Card look (v5 build spec 01 styling pass — public,
// customer-facing pages share one visual system with the quote acceptance page). Server
// component — no client JS beyond the processing poller. The Pay button is a plain
// `<form method="post">` to `./checkout` (a route handler), so a click needs zero client
// JavaScript: Stripe Checkout is a full-page hosted redirect anyway.

import type { PublicInvoicePayload } from '@auxx/lib/money'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Card } from '@auxx/ui/components/card'
import { Loader2 } from 'lucide-react'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import {
  PublicDocumentContact,
  PublicDocumentHeader,
} from '~/components/money/ui/public-document/public-document-header'
import { PublicDocumentLineItems } from '~/components/money/ui/public-document/public-document-line-items'
import { PublicDocumentShell } from '~/components/money/ui/public-document/public-document-shell'
import { PublicDocumentTotals } from '~/components/money/ui/public-document/public-document-totals'
import { PartialPaymentForm } from './partial-payment-form'
import { ProcessingPoller } from './processing-poller'

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
    depositApplied,
    currency,
    business,
    branding,
    paymentsEnabled,
    processingPayment,
    allowPartialPayments,
    minPaymentAmount,
  } = payload

  // Deposit-accounting plan 16 §E: `amountPaid` already NETS IN the deposit allocations
  // (`computeAmountPaid` sums every allocation regardless of source), so a plain "Amount
  // paid" row would double-count the deposit against the "Deposit applied" breakout below.
  // Split the one line into two — presentation only, same underlying total — so
  // Total − Deposit applied − Payments visibly sums to Balance due.
  const paymentsOnly = amountPaid - depositApplied

  const isPaid = status === 'paid' || balance <= 0
  const isVoid = status === 'void'
  const showProcessing = processingPayment || (checkoutState === 'success' && !isPaid)
  const canPay = !showProcessing && !isPaid && !isVoid && paymentsEnabled && balance > 0

  return (
    <PublicDocumentShell>
      <ProcessingPoller active={showProcessing} />
      <Card variant='translucent' className='w-full px-4 py-6 sm:px-10 sm:py-10'>
        <PublicDocumentHeader
          logoUrl={branding.logo?.url}
          companyName={business.companyName}
          email={business.email}
          phone={business.phone}
          documentLabel='Invoice'
          documentNumber={number}
          issuedAt={issuedAt}
          secondaryDateLabel={dueDate ? 'Due' : undefined}
          secondaryDateValue={dueDate}
        />

        <PublicDocumentContact label='Billed to' name={contact.name} email={contact.email} />

        <PublicDocumentLineItems lines={lines} currency={currency} />

        <PublicDocumentTotals
          currency={currency}
          subtotal={subtotal}
          discountAmount={discountAmount}
          taxName={taxName}
          taxRate={taxRate}
          taxTotal={taxTotal}
          total={total}
          footerRows={
            depositApplied > 0
              ? [
                  { label: 'Deposit applied', value: -depositApplied },
                  ...(paymentsOnly > 0 ? [{ label: 'Payments', value: -paymentsOnly }] : []),
                  { label: 'Balance due', value: Math.max(balance, 0), emphasize: true },
                ]
              : [
                  ...(amountPaid > 0 ? [{ label: 'Amount paid', value: amountPaid }] : []),
                  { label: 'Balance due', value: Math.max(balance, 0), emphasize: true },
                ]
          }
        />

        {/* ─── Payment state / action ─────────────────────────────────────── */}
        <div className='mt-8 border-white/10 border-t pt-6'>
          {checkoutError ? (
            <Alert
              variant='translucent'
              className='mb-4 border border-destructive/40 bg-destructive/10'>
              <AlertDescription className='text-white/90'>
                Payment failed: {checkoutError}
              </AlertDescription>
            </Alert>
          ) : null}

          {showProcessing ? (
            <div className='flex items-center gap-2 text-sm text-white/60'>
              <Loader2 className='size-4 animate-spin' />
              <span>Payment processing… this page updates automatically.</span>
            </div>
          ) : isPaid ? (
            <p className='font-medium text-sm text-success'>Paid in full — thank you.</p>
          ) : canPay ? (
            allowPartialPayments ? (
              <PartialPaymentForm
                token={token}
                balance={balance}
                minPaymentAmount={minPaymentAmount}
                currency={currency}
              />
            ) : (
              <form method='post' action={`/pay/${token}/checkout`}>
                <Button type='submit' variant='translucent' size='lg'>
                  Pay {formatCurrency(balance, currency)}
                </Button>
              </form>
            )
          ) : null}
        </div>
      </Card>
    </PublicDocumentShell>
  )
}
