// apps/web/src/app/(public)/pay/[token]/photo/[ref]/route.ts

import { resolvePhotoRef } from '@auxx/lib/documents'
import { getPublicInvoicePayload, resolveInvoiceByPublicToken } from '@auxx/lib/money'
import { NextResponse } from 'next/server'

/**
 * GET /pay/:token/photo/:ref — public by design (plan 37b §6), the byte source behind the
 * pay page's line thumbnails and header "Photos" gallery. Direct mirror of the quote page's
 * `/quote/[token]/photo/[ref]` route — see its doc comment for the full IDOR-guard rationale.
 * No `acceptancePageEnabled`-equivalent master switch on the invoice side (the pay page has
 * none either), so the only gates here are the token and the payload allow-list.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; ref: string }> }
) {
  const { token, ref: encodedRef } = await params
  const ref = decodeURIComponent(encodedRef)

  const resolved = await resolveInvoiceByPublicToken(token)
  if (!resolved) return photoNotFound()

  const payload = await getPublicInvoicePayload(token)
  if (!payload) return photoNotFound()

  const allowed =
    payload.photos.some((photo) => photo.ref === ref) ||
    payload.lines.some((line) => (line.photos ?? []).some((photo) => photo.ref === ref))
  if (!allowed) return photoNotFound()

  const bytes = await resolvePhotoRef(resolved.organizationId, ref)
  if (!bytes) return photoNotFound()

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      'Content-Length': bytes.length.toString(),
    },
  })
}

function photoNotFound() {
  return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
}
