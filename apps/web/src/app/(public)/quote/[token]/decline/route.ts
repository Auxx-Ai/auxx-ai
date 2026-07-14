// apps/web/src/app/(public)/quote/[token]/decline/route.ts

import { AuxxError } from '@auxx/lib/errors'
import { declineQuoteByToken } from '@auxx/lib/money'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('quote-decline')

/**
 * POST /quote/:token/decline — public by design (v5 build spec 01). Plain form POST target
 * (the Decline form nested inside `public-quote-document.tsx`'s `<details>` disclosure), 303
 * redirect on both success (→ `?state=declined`) and failure (→ `?state=error&message=...`).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const formData = await request.formData()
  const reason = formData.get('reason')

  try {
    await declineQuoteByToken(token, { reason: typeof reason === 'string' ? reason : undefined })
    const redirectUrl = new URL(`/quote/${token}`, request.url)
    redirectUrl.searchParams.set('state', 'declined')
    return NextResponse.redirect(redirectUrl, { status: 303 })
  } catch (error) {
    const message = error instanceof AuxxError ? error.message : 'Unable to decline this quote'
    logger.error('Quote decline failed', { token, error: message })
    const redirectUrl = new URL(`/quote/${token}`, request.url)
    redirectUrl.searchParams.set('state', 'error')
    redirectUrl.searchParams.set('message', message)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }
}
