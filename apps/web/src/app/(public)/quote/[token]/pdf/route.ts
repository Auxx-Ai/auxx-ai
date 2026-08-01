// apps/web/src/app/(public)/quote/[token]/pdf/route.ts

import { getQuotePdfByToken } from '@auxx/lib/money'
import { NextResponse } from 'next/server'

/**
 * GET /quote/:token/pdf — public by design (v5 build spec 01), the page's "Download PDF" link.
 * Resolves the token server-side and streams the same rendered PDF the org sees, 404 on an
 * unknown/stale token — never leaking whether one ever existed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const result = await getQuotePdfByToken(token)
  if (!result) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': result.buffer.length.toString(),
    },
  })
}
