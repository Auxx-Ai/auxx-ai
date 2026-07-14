// apps/web/src/components/money/ui/public-quote/public-quote-document.tsx

// The branded public quote-acceptance document + Accept/Decline/Request-update flow (v5
// build spec 01 — client-facing quote acceptance page), plus the deposit-on-acceptance step
// (money MP2 build spec §B.8 — "loose" flow: accept completes independently, THEN the accepted
// state chains into a deposit-pay step). Server component; the interactive action area (submit
// pending states, decline disclosure) lives in the `public-quote-actions.tsx` client components,
// but every action is still a plain `<form method="post">` to a route handler.

import type { PublicQuotePayload } from '@auxx/lib/money'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Card } from '@auxx/ui/components/card'
import { Download, Loader2 } from 'lucide-react'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { formatDocumentDate } from '~/components/money/ui/public-document/format'
import {
  PublicDocumentContact,
  PublicDocumentHeader,
} from '~/components/money/ui/public-document/public-document-header'
import { PublicDocumentLineItems } from '~/components/money/ui/public-document/public-document-line-items'
import { PublicDocumentShell } from '~/components/money/ui/public-document/public-document-shell'
import { PublicDocumentTotals } from '~/components/money/ui/public-document/public-document-totals'
import { ProcessingPoller } from '~/components/money/ui/public-invoice/processing-poller'
import {
  QuoteAcceptForm,
  QuoteDeclineForm,
  QuoteDepositForm,
  QuoteRequestUpdateForm,
} from '~/components/money/ui/public-quote/public-quote-actions'

interface PublicQuoteDocumentProps {
  token: string
  payload: PublicQuotePayload
  /** `?state=` — `accepted' | 'declined' | 'update-requested' | 'error'`, or unset. */
  state: string | undefined
  /** `?message=` — populated alongside `state === 'error'`. */
  message: string | undefined
}

export function PublicQuoteDocument({ token, payload, state, message }: PublicQuoteDocumentProps) {
  const {
    number,
    status,
    issuedAt,
    validUntil,
    isExpired,
    terms,
    contact,
    lines,
    subtotal,
    discountAmount,
    taxName,
    taxRate,
    taxTotal,
    total,
    currency,
    business,
    branding,
    acceptedByName,
    acceptedAt,
    declineReason,
    allowDecline,
    requireSignature,
    depositAmount,
    depositPaid,
    depositPending,
    paymentsEnabled,
  } = payload

  const isSent = status === 'sent'
  const isApproved = status === 'approved'
  const isDeclined = status === 'declined'
  const isBeingRevised = !isSent && !isApproved && !isDeclined
  const showAcceptDecline = isSent && !isExpired
  const showExpiredCta = isSent && isExpired
  const showDownload = status !== 'draft'
  const updateRequested = state === 'update-requested'
  // Deposit step (money MP2 build spec §B.8) — only meaningful once the quote is accepted, a
  // deposit is actually configured, and the org can take a Stripe payment at all.
  const showDeposit = isApproved && depositAmount > 0 && paymentsEnabled

  return (
    <PublicDocumentShell>
      <ProcessingPoller active={showDeposit && depositPending} />
      <Card variant='translucent' className='w-full px-4 py-6 sm:px-10 sm:py-10'>
        <PublicDocumentHeader
          logoUrl={branding.logo?.url}
          companyName={business.companyName}
          email={business.email}
          phone={business.phone}
          documentLabel='Quote'
          documentNumber={number}
          issuedAt={issuedAt}
          secondaryDateLabel={validUntil ? 'Valid until' : undefined}
          secondaryDateValue={validUntil}
        />

        <PublicDocumentContact label='Prepared for' name={contact.name} email={contact.email} />

        <PublicDocumentLineItems lines={lines} currency={currency} />

        <PublicDocumentTotals
          currency={currency}
          subtotal={subtotal}
          discountAmount={discountAmount}
          taxName={taxName}
          taxRate={taxRate}
          taxTotal={taxTotal}
          total={total}
        />

        {terms ? (
          <div className='mt-6 border-white/10 border-t pt-4'>
            <p className='text-white/50 text-xs uppercase tracking-wide'>Terms</p>
            <p className='mt-1 whitespace-pre-wrap text-sm text-white/70'>{terms}</p>
          </div>
        ) : null}

        <div className='mt-8 border-white/10 border-t pt-6'>
          {state === 'error' && message ? (
            <Alert
              variant='translucent'
              className='mb-4 border border-destructive/40 bg-destructive/10'>
              <AlertDescription className='text-white/90'>{message}</AlertDescription>
            </Alert>
          ) : null}

          {isApproved ? (
            <div className='space-y-4'>
              <Alert variant='translucent'>
                <AlertDescription className='text-white/90'>
                  Accepted
                  {acceptedByName ? ` by ${acceptedByName}` : ''}
                  {acceptedAt ? ` on ${formatDocumentDate(acceptedAt)}` : ''}
                </AlertDescription>
              </Alert>
              {showDeposit ? (
                depositPaid ? (
                  <p className='font-medium text-sm text-success'>
                    Deposit of {formatCurrency(depositAmount, currency)} received.
                  </p>
                ) : depositPending ? (
                  <div className='flex items-center gap-2 text-sm text-white/60'>
                    <Loader2 className='size-4 animate-spin' />
                    <span>Deposit processing… this page updates automatically.</span>
                  </div>
                ) : (
                  <QuoteDepositForm
                    token={token}
                    amountLabel={formatCurrency(depositAmount, currency)}
                  />
                )
              ) : null}
            </div>
          ) : isDeclined ? (
            <Alert variant='translucent'>
              <AlertDescription className='text-white/90'>
                This quote was declined.{declineReason ? ` Reason: ${declineReason}` : ''}
              </AlertDescription>
            </Alert>
          ) : showExpiredCta ? (
            <div className='space-y-4'>
              <Alert variant='translucent'>
                <AlertDescription className='text-white/90'>
                  This quote expired on {formatDocumentDate(validUntil)}.
                </AlertDescription>
              </Alert>
              {updateRequested ? (
                <p className='text-sm text-white/70'>
                  We&apos;ve let the team know — you&apos;ll hear back with an updated quote soon.
                </p>
              ) : (
                <QuoteRequestUpdateForm token={token} />
              )}
            </div>
          ) : showAcceptDecline ? (
            <div className='space-y-6'>
              <QuoteAcceptForm token={token} requireSignature={requireSignature} />
              {allowDecline ? <QuoteDeclineForm token={token} /> : null}
            </div>
          ) : isBeingRevised ? (
            <Alert variant='translucent'>
              <AlertDescription className='text-white/90'>
                This quote is currently being revised. Check back soon or contact us.
              </AlertDescription>
            </Alert>
          ) : null}

          {showDownload ? (
            <div className='mt-6'>
              <a
                href={`/quote/${token}/pdf`}
                className='inline-flex items-center gap-1.5 text-sm text-white/60 underline underline-offset-4 hover:text-white/90'>
                <Download className='size-3.5' />
                Download PDF
              </a>
            </div>
          ) : null}
        </div>
      </Card>
    </PublicDocumentShell>
  )
}
