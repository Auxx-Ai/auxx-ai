// apps/web/src/app/(public)/quote/[token]/request-update/route.ts

import { AuxxError } from '@auxx/lib/errors'
import { requestQuoteUpdateByToken } from '@auxx/lib/money'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('quote-request-update')

/**
 * POST /quote/:token/request-update — public by design (v5 build spec 01). The expired-quote
 * CTA: plain form POST, 303 redirect on both success (→ `?state=update-requested`) and failure
 * (→ `?state=error&message=...`).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  try {
    await requestQuoteUpdateByToken(token)
    const redirectUrl = new URL(`/quote/${token}`, request.url)
    redirectUrl.searchParams.set('state', 'update-requested')
    return NextResponse.redirect(redirectUrl, { status: 303 })
  } catch (error) {
    const message =
      error instanceof AuxxError ? error.message : 'Unable to request an updated quote'
    logger.error('Quote request-update failed', { token, error: message })
    const redirectUrl = new URL(`/quote/${token}`, request.url)
    redirectUrl.searchParams.set('state', 'error')
    redirectUrl.searchParams.set('message', message)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }
}
