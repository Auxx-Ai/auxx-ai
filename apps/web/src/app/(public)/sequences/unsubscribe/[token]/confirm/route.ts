// apps/web/src/app/(public)/sequences/unsubscribe/[token]/confirm/route.ts

import { unsubscribeByToken } from '@auxx/lib/sequences'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('sequence-unsubscribe')

/**
 * POST /sequences/unsubscribe/:token/confirm — public by design (Sequences
 * plan §8). Plain form POST target (see `unsubscribe-confirm-form.tsx`), so a
 * 303 redirect back to the page is correct on both paths, mirroring
 * `quote/[token]/accept/route.ts`. Idempotent: `unsubscribeByToken` exits the
 * run (if still active) and always upserts the org-wide suppression row. The
 * error redirect never says why — the token is the only capability and the
 * page must not leak anything beyond its own payload.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const redirectUrl = new URL(`/sequences/unsubscribe/${token}`, request.url)

  const result = await unsubscribeByToken(token)
  if (result.isErr()) {
    logger.error('Unsubscribe by token failed', { error: result.error.message })
    redirectUrl.searchParams.set('state', 'error')
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }

  redirectUrl.searchParams.set('state', 'unsubscribed')
  return NextResponse.redirect(redirectUrl, { status: 303 })
}
