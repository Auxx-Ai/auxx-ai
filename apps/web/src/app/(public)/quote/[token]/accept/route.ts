// apps/web/src/app/(public)/quote/[token]/accept/route.ts

import { AuxxError } from '@auxx/lib/errors'
import { acceptQuoteByToken, buildQuoteViewUrl } from '@auxx/lib/money'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('quote-accept')

/**
 * POST /quote/:token/accept — public by design (v5 build spec 01). Plain form POST target
 * (see `public-quote-document.tsx`'s Accept form), so a 303 redirect is correct on both the
 * happy path (→ `?state=accepted`) and the error path (→ `?state=error&message=...`), mirroring
 * `pay/[token]/checkout/route.ts`'s established shape.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const formData = await request.formData()
  const name = formData.get('name')
  // The page always renders every optional line's checkbox (money plan 18 §4), so this route
  // always provides the array — an empty array on an all-unchecked submit correctly means
  // "deselect every optional line" (standard HTML form semantics), never "leave defaults
  // untouched" (that's `undefined`, which this route never sends). Zero-optional quotes send
  // an empty array too; `acceptQuoteByToken` no-ops when the quote has no optional lines.
  const selectedLineIds = formData.getAll('selectedLineIds').map(String)

  try {
    await acceptQuoteByToken(token, {
      name: typeof name === 'string' ? name : undefined,
      selectedLineIds,
    })
    const redirectUrl = new URL(buildQuoteViewUrl(token))
    redirectUrl.searchParams.set('state', 'accepted')
    return NextResponse.redirect(redirectUrl, { status: 303 })
  } catch (error) {
    const message = error instanceof AuxxError ? error.message : 'Unable to accept this quote'
    logger.error('Quote accept failed', { token, error: message })
    const redirectUrl = new URL(buildQuoteViewUrl(token))
    redirectUrl.searchParams.set('state', 'error')
    redirectUrl.searchParams.set('message', message)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }
}
