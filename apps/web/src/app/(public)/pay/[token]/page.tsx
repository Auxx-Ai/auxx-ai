// apps/web/src/app/(public)/pay/[token]/page.tsx

import { getPublicInvoicePayload } from '@auxx/lib/money'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicInvoiceDocument } from '~/components/money/ui/public-invoice/public-invoice-document'

export const metadata: Metadata = {
  title: 'Pay invoice',
  robots: { index: false, follow: false },
}

interface PayInvoicePageProps {
  params: Promise<{ token: string }>
}

/**
 * Public, unauthenticated invoice pay page — `/pay/{token}`. The token IS the capability: no
 * session, no org context, resolved purely from the token by `getPublicInvoicePayload`. 404s
 * on an unknown/stale token rather than leaking whether one ever existed.
 *
 * Accounting migration step 0 dropped the Stripe Checkout flow this page used to drive
 * (`PaymentTransaction` and the checkout/webhook routes are gone) — the page is read-only
 * until online payment collection is rebuilt on the money model.
 */
export default async function PayInvoicePage({ params }: PayInvoicePageProps) {
  const { token } = await params

  const payload = await getPublicInvoicePayload(token)
  if (!payload) notFound()

  return <PublicInvoiceDocument token={token} payload={payload} />
}
