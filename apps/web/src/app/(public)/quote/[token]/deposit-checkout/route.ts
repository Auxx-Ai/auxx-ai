// apps/web/src/app/(public)/quote/[token]/deposit-checkout/route.ts

import { AuxxError } from '@auxx/lib/errors'
import { createStripeDepositCheckout, resolveQuoteByPublicToken } from '@auxx/lib/money'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('quote-deposit-checkout')

/**
 * POST /quote/:token/deposit-checkout — public by design (money MP2 build spec §B.6). Mirrors
 * `pay/[token]/checkout/route.ts`: re-resolves the quote from the token server-side on every
 * call and always charges the CURRENT configured deposit — `createStripeDepositCheckout` never
 * trusts (and is never passed) a client-supplied amount. Plain form POST target (see
 * `QuoteDepositForm` in `public-quote-actions.tsx`), so a 303 redirect is correct on both the
 * happy path (→ Stripe Checkout) and the error path (→ back to the quote page with
 * `state=error`, the same convention `accept`/`decline` use).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const resolved = await resolveQuoteByPublicToken(token)
  if (!resolved) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  try {
    const { checkoutUrl } = await createStripeDepositCheckout({
      organizationId: resolved.organizationId,
      quoteInstanceId: resolved.quoteInstanceId,
    })
    return NextResponse.redirect(checkoutUrl, { status: 303 })
  } catch (error) {
    const message = error instanceof AuxxError ? error.message : 'Unable to start checkout'
    logger.error('Stripe deposit checkout failed', { token, error: message })
    const redirectUrl = new URL(`/quote/${token}`, request.url)
    redirectUrl.searchParams.set('state', 'error')
    redirectUrl.searchParams.set('message', message)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }
}
