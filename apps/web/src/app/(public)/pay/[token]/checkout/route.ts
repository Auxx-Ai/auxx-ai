// apps/web/src/app/(public)/pay/[token]/checkout/route.ts

import { AuxxError } from '@auxx/lib/errors'
import { createStripeCheckout, resolveInvoiceByPublicToken } from '@auxx/lib/money'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('pay-checkout')

/**
 * POST /pay/:token/checkout — public by design (money MP1 build spec §I). Re-resolves the
 * invoice from the token server-side on every call. Plain form POST target (see
 * `public-invoice-document.tsx`'s Pay button / `partial-payment-form.tsx`), so a 303 redirect
 * is correct on both the happy path (→ Stripe Checkout) and the error path (→ back to the pay
 * page with `checkout_error`).
 *
 * Money MP2 §C: an optional `amount` form field carries a partial-payment amount as a decimal
 * currency string (e.g. `"42.50"`), converted to integer cents here. Absent, empty, or
 * non-numeric values are treated identically to "not provided" — `createStripeCheckout` then
 * falls back to its unchanged default (the full current balance), so behavior is byte-identical
 * to pre-MP2 for every caller that doesn't send the field. The server never trusts this value
 * past that — `createStripeCheckout` re-validates it against
 * `[resolvePartialPaymentBounds(balance, minPercent).min, balance]` and the org's
 * `documents.invoice.allowPartialPayments` toggle.
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
  const amount = Number.isFinite(parsedAmount) ? parsedAmount : undefined

  try {
    const { checkoutUrl } = await createStripeCheckout({
      organizationId: resolved.organizationId,
      invoiceInstanceId: resolved.invoiceInstanceId,
      ...(amount !== undefined ? { amount } : {}),
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
