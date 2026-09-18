// apps/web/src/app/(public)/pay/[token]/page.tsx

import { getPublicInvoicePayload } from '@auxx/lib/sales'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicInvoiceDocument } from '~/components/money/ui/public-invoice/public-invoice-document'

export const metadata: Metadata = {
  title: 'Pay invoice',
  robots: { index: false, follow: false },
}

interface PayInvoicePageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ checkout?: string; checkout_error?: string }>
}

/**
 * Public, unauthenticated invoice pay page — `/pay/{token}`. The token IS the capability: no
 * session, no org context, resolved purely from the token by `getPublicInvoicePayload`. 404s
 * on an unknown/stale token rather than leaking whether one ever existed.
 *
 * The webhook is the settlement path: nothing is recorded until Stripe confirms, so
 * `?checkout=success` only arms the page's processing poller, it never asserts payment.
 */
export default async function PayInvoicePage({ params, searchParams }: PayInvoicePageProps) {
  const [{ token }, sp] = await Promise.all([params, searchParams])

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
