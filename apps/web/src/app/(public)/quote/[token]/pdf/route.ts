// apps/web/src/app/(public)/quote/[token]/pdf/route.ts

import { encodeContentDisposition } from '@auxx/lib/files/server'
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
      // A quote filename carries the customer/quote name — one non-Latin-1
      // character in it would throw on Response construction. See RFC 6266.
      'Content-Disposition': encodeContentDisposition('attachment', result.filename),
      'Content-Length': result.buffer.length.toString(),
    },
  })
}
