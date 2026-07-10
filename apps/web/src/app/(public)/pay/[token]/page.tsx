// apps/web/src/app/(public)/pay/[token]/page.tsx

import { cancelAbandonedCheckout, getPublicInvoicePayload } from '@auxx/lib/money'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicInvoiceDocument } from '~/components/money/ui/public-invoice/public-invoice-document'

export const metadata: Metadata = {
  title: 'Pay invoice',
  robots: { index: false, follow: false },
}

interface PayInvoicePageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ checkout?: string; checkout_error?: string; tx?: string }>
}

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
