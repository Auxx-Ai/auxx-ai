// apps/web/src/app/(public)/quote/[token]/deposit-checkout/route.ts

import { createQuoteDepositCheckoutSession } from '@auxx/lib/accounting/money'
import { buildQuoteViewUrl, resolveQuoteByPublicToken } from '@auxx/lib/accounting/sales'
import { AuxxError } from '@auxx/lib/errors'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('quote-deposit-checkout')

/**
 * POST /quote/:token/deposit-checkout — the deposit mirror of `pay/[token]/checkout`. Always
 * charges the CURRENTLY configured deposit: no client-supplied amount is accepted or read.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const resolved = await resolveQuoteByPublicToken(token)
  if (!resolved) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  try {
    const { checkoutUrl } = await createQuoteDepositCheckoutSession({
      organizationId: resolved.organizationId,
      quoteInstanceId: resolved.quoteInstanceId,
    })
    return NextResponse.redirect(checkoutUrl, { status: 303 })
  } catch (error) {
    const message = error instanceof AuxxError ? error.message : 'Unable to start checkout'
    logger.error('Stripe deposit checkout failed', { token, error: message })
    const redirectUrl = new URL(buildQuoteViewUrl(token))
    redirectUrl.searchParams.set('state', 'error')
    redirectUrl.searchParams.set('message', message)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }
}
