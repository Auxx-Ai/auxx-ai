// apps/web/src/app/(public)/quote/[token]/page.tsx

import {
  cancelAbandonedDepositCheckout,
  getPublicQuotePayload,
  reconcileStripeDepositCheckoutReturn,
  resolveQuoteByPublicToken,
} from '@auxx/lib/money'
import { createScopedLogger } from '@auxx/logger'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { PublicQuoteDocument } from '~/components/money/ui/public-quote/public-quote-document'

export const metadata: Metadata = {
  title: 'Quote',
  robots: { index: false, follow: false },
}

interface PublicQuotePageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{
    state?: string
    message?: string
    checkout?: string
    tx?: string
    session_id?: string
  }>
}

const logger = createScopedLogger('public-quote')

/**
 * Public, unauthenticated quote acceptance page (v5 build spec 01) — `/quote/{token}`. Mirrors
 * the invoice `/pay/{token}` page: the token IS the capability, no session, no org context,
 * resolved purely from the token by `getPublicQuotePayload`. 404s on an unknown/stale token OR
 * a disabled acceptance page — `getPublicQuotePayload`'s doc comment is explicit that the two
 * cases must not be distinguishable to the visitor, so neither this page nor the mutation
 * route handlers ever leak which one it is.
 */
export default async function PublicQuotePage({ params, searchParams }: PublicQuotePageProps) {
  const [{ token }, sp] = await Promise.all([params, searchParams])

  // Landing back via Stripe's cancel_url — release the pending deposit ledger row this
  // Checkout minted so the page immediately offers Pay again (guarded server-side by the
  // token; the invoice pay page's `cancelAbandonedCheckout` recipe).
  if (sp.checkout === 'cancel' && sp.tx) {
    await cancelAbandonedDepositCheckout(token, sp.tx)
  }

  // Webhooks remain the normal settlement path. On Stripe's success redirect, verify the
  // Checkout Session directly as a recovery path for delayed or temporarily unavailable
  // webhook delivery, then apply the same idempotent ledger transition as the webhook.
  if (sp.checkout === 'success' && sp.session_id) {
    const resolved = await resolveQuoteByPublicToken(token)
    if (resolved) {
      let reconciled = false
      try {
        await reconcileStripeDepositCheckoutReturn({
          organizationId: resolved.organizationId,
          quoteInstanceId: resolved.quoteInstanceId,
          sessionId: sp.session_id,
        })
        reconciled = true
      } catch (error) {
        logger.error('Unable to reconcile returned Stripe deposit Checkout', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      if (reconciled) redirect(`/quote/${token}`)
    }
  }

  const payload = await getPublicQuotePayload(token)
  if (!payload || !payload.acceptancePageEnabled) notFound()

  return (
    <PublicQuoteDocument token={token} payload={payload} state={sp.state} message={sp.message} />
  )
}
