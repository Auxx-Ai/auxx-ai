// apps/web/src/app/(public)/quote/[token]/photo/[ref]/route.ts

import { resolvePhotoRef } from '@auxx/lib/documents'
import { getPublicQuotePayload, resolveQuoteByPublicToken } from '@auxx/lib/money'
import { NextResponse } from 'next/server'

/**
 * GET /quote/:token/photo/:ref — public by design (plan 37b §6), the byte source behind the
 * quote page's line thumbnails and header "Photos" gallery. The public page has no session,
 * so a photo ref (`"asset:<id>"` | `"file:<id>"`) isn't otherwise fetchable.
 *
 * IDOR guard: resolves the token, rebuilds this quote's public payload (already
 * internal-filtered by `buildQuotePdfPayload`'s `extractPhotos`), and serves `ref` ONLY if it
 * appears in that payload's header `photos` or one of its `lines[].photos` — a valid token can
 * never be used to fetch an arbitrary asset/file id off the URL alone. 404s on an unknown
 * token, a disabled acceptance page, an unlisted ref, or a broken/missing asset — same
 * "don't leak which case" posture as the sibling `pdf/route.ts`.
 *
 * Streams the same sharp-downscaled JPEG bytes the PDF embeds (`resolvePhotoRef`, ≤1200px,
 * q80) — the public page never needs multi-MB camera originals.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; ref: string }> }
) {
  const { token, ref: encodedRef } = await params
  const ref = decodeURIComponent(encodedRef)

  const resolved = await resolveQuoteByPublicToken(token)
  if (!resolved) return photoNotFound()

  const payload = await getPublicQuotePayload(token)
  if (!payload || !payload.acceptancePageEnabled) return photoNotFound()

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
