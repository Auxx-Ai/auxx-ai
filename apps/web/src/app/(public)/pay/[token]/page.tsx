// apps/web/src/app/(public)/pay/[token]/page.tsx

import {
  cancelAbandonedCheckout,
  getPublicInvoicePayload,
  reconcileStripeCheckoutReturn,
  resolveInvoiceByPublicToken,
} from '@auxx/lib/money'
import { createScopedLogger } from '@auxx/logger'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { PublicInvoiceDocument } from '~/components/money/ui/public-invoice/public-invoice-document'

export const metadata: Metadata = {
  title: 'Pay invoice',
  robots: { index: false, follow: false },
}

interface PayInvoicePageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{
    checkout?: string
    checkout_error?: string
    tx?: string
    session_id?: string
  }>
}

const logger = createScopedLogger('public-invoice-pay')

/**
 * Public, unauthenticated invoice pay page (money MP1 build spec §I) — `/pay/{token}`. The
 * token IS the capability: no session, no org context, resolved purely from the token by
 * `getPublicInvoicePayload`. 404s on an unknown/stale token rather than leaking whether one
 * ever existed.
 */
export default async function PayInvoicePage({ params, searchParams }: PayInvoicePageProps) {
  const [{ token }, sp] = await Promise.all([params, searchParams])

  // Landing back via Stripe's cancel_url — release the pending ledger row this Checkout
  // minted so the page immediately offers Pay again (guarded server-side by the token).
  if (sp.checkout === 'cancel' && sp.tx) {
    await cancelAbandonedCheckout(token, sp.tx)
  }

  // Webhooks remain the normal settlement path. On Stripe's success redirect, verify the
  // Checkout Session directly as a recovery path for delayed or temporarily unavailable
  // webhook delivery (dev without `stripe listen`, or a not-yet-set prod webhook secret), then
  // apply the same idempotent ledger transition as the webhook — see the quote `/quote/{token}`
  // page's identical recipe.
  if (sp.checkout === 'success' && sp.session_id) {
    const resolved = await resolveInvoiceByPublicToken(token)
    if (resolved) {
      let reconciled = false
      try {
        await reconcileStripeCheckoutReturn({
          organizationId: resolved.organizationId,
          invoiceInstanceId: resolved.invoiceInstanceId,
          sessionId: sp.session_id,
        })
        reconciled = true
      } catch (error) {
        logger.error('Unable to reconcile returned Stripe Checkout', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      if (reconciled) redirect(`/pay/${token}`)
    }
  }

  const payload = await getPublicInvoicePayload(token)
  if (!payload) notFound()

  return (
    <PublicInvoiceDocument
      token={token}
      payload={payload}
      checkoutState={sp.checkout}
      checkoutError={sp.checkout_error}
    />
  )
}
