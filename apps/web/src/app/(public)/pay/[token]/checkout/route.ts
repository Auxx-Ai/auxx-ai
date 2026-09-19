// apps/web/src/app/(public)/pay/[token]/checkout/route.ts

import { createInvoiceCheckoutSession } from '@auxx/lib/accounting/money'
import { resolveInvoiceByPublicToken } from '@auxx/lib/accounting/sales'
import { AuxxError } from '@auxx/lib/errors'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('pay-checkout')

/**
 * POST /pay/:token/checkout — public by design: the token IS the capability, and the invoice is
 * re-resolved from it server-side on every call. A plain form POST target, so a 303 is correct
 * on both the happy path (→ Stripe Checkout) and the error path (→ back to the pay page).
 *
 * An optional `amount` form field carries a partial payment as a decimal currency string;
 * absent, empty or non-numeric is "not provided" and charges the whole balance. The value is
 * re-validated server-side against the org's partial-payment settings.
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

  const formData = await request.formData()
  const rawAmount = formData.get('amount')
  const parsedAmount =
    typeof rawAmount === 'string' && rawAmount.trim() !== ''
      ? Math.round(Number(rawAmount) * 100)
      : Number.NaN
  const amountMinor = Number.isFinite(parsedAmount) ? parsedAmount : undefined

  try {
    const { checkoutUrl } = await createInvoiceCheckoutSession({
      organizationId: resolved.organizationId,
      invoiceInstanceId: resolved.invoiceInstanceId,
      ...(amountMinor !== undefined ? { amountMinor } : {}),
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
