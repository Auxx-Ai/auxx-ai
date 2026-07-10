// apps/web/src/app/(public)/pay/[token]/checkout/route.ts

import { AuxxError } from '@auxx/lib/errors'
import { createStripeCheckout, resolveInvoiceByPublicToken } from '@auxx/lib/money'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('pay-checkout')

/**
 * POST /pay/:token/checkout — public by design (money MP1 build spec §I). Re-resolves the
 * invoice from the token server-side on every call and always charges the CURRENT balance —
 * `createStripeCheckout` never trusts (and is never passed) a client-supplied amount. Plain
 * form POST target (see `public-invoice-document.tsx`'s Pay button), so a 303 redirect is
 * correct on both the happy path (→ Stripe Checkout) and the error path (→ back to the pay
 * page with `checkout_error`).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const resolved = await resolveInvoiceByPublicToken(token)
  if (!resolved) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  try {
    const { checkoutUrl } = await createStripeCheckout({
      organizationId: resolved.organizationId,
      invoiceInstanceId: resolved.invoiceInstanceId,
    })
    return NextResponse.redirect(checkoutUrl, { status: 303 })
  } catch (error) {
    const message = error instanceof AuxxError ? error.message : 'Unable to start checkout'
    logger.error('Stripe checkout failed', { token, error: message })
    const redirectUrl = new URL(`/pay/${token}`, request.url)
    redirectUrl.searchParams.set('checkout_error', message)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }
}
