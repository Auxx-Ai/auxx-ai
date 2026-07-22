// packages/lib/src/dispatch/visit-report/render.ts
//
// On-demand render of a visit report to a short-lived `MediaAsset` (37d §5) — the visit analog of
// `documents/preview-pdf.ts`. Visits aren't FieldValue-backed entities, so there's no pointer/
// content-hash cache (unlike quote/invoice `ensure-pdf.ts`): every call renders fresh and uploads
// a ~1h asset the caller opens via the shared `/api/files/download/asset:<id>` proxy. Reuses the
// documents module's `resolvePhotoRef` (downscale/transcode) so photo bytes match the PDF path.

import { database as db, schema } from '@auxx/database'
import type { DocumentProps } from '@react-pdf/renderer'
import { renderToBuffer } from '@react-pdf/renderer'
import { eq } from 'drizzle-orm'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import { resolvePhotoRef } from '../../documents/render'
import { MediaAssetService } from '../../files/core/media-asset-service'
import { createStorageManager } from '../../files/storage/storage-manager'
import { buildVisitReportPayload, type VisitReportPayload } from './payload'
import { VisitReportPdf } from './visit-report-pdf'

/** A rendered report lives an hour — long enough to open in a new tab, short enough not to pile up. */
const REPORT_ASSET_TTL_MS = 60 * 60 * 1000

/** Resolve every photo ref on the report's checklist items to downscaled JPEG bytes, keyed by
 * ref. A ref that fails to resolve is simply absent — the PDF skips it silently. */
async function resolveReportPhotoBytes(payload: VisitReportPayload): Promise<Map<string, Buffer>> {
  const refs = new Set<string>()
  for (const item of payload.items) {
    for (const photo of item.photos) refs.add(photo.ref)
  }
  if (refs.size === 0) return new Map()

  const resolved = await Promise.all(
    Array.from(refs).map(
      async (ref) => [ref, await resolvePhotoRef(payload.organizationId, ref)] as const
    )
  )
  const photoBytes = new Map<string, Buffer>()
  for (const [ref, bytes] of resolved) {
    if (bytes) photoBytes.set(ref, bytes)
  }
  return photoBytes
}

/** Render a visit-report payload to a PDF buffer — loads the org logo bytes server-side (missing
 * logo renders without one, same fail-soft contract as the quote/invoice renderer). */
export async function renderVisitReportPdf(payload: VisitReportPayload): Promise<Buffer> {
  const logoAssetId = payload.settings.branding.logo?.assetId
  let logoBytes: Buffer | null = null
  if (logoAssetId) {
    try {
      logoBytes = await new MediaAssetService(payload.organizationId).getContent(logoAssetId)
    } catch {
      logoBytes = null
    }
  }

  const photoBytes = await resolveReportPhotoBytes(payload)
  const element = createElement(VisitReportPdf, { payload, logoBytes, photoBytes })
  return renderToBuffer(element as unknown as ReactElement<DocumentProps>)
}

/** Result of {@link renderVisitReportToAsset}. */
export interface RenderVisitReportResult {
  assetId: string
  fileName: string
}

/**
 * Build + render one visit's report and upload it as a short-lived (`expiresAt` ~1h) `MediaAsset`,
 * returning its id for the caller to open via the file-download proxy. Mirrors
 * `documents/preview-pdf.ts`.
 */
export async function renderVisitReportToAsset(params: {
  organizationId: string
  actorId: string
  visitId: string
}): Promise<RenderVisitReportResult> {
  const { organizationId, actorId, visitId } = params

  const payload = await buildVisitReportPayload({ organizationId, userId: actorId, visitId })
  const buffer = await renderVisitReportPdf(payload)

  const fileName = `visit-report-${payload.workOrderNumber || visitId}.pdf`
  const storageManager = createStorageManager(organizationId)
  const storageKey = `documents/${organizationId}/visit-report/${visitId}.pdf`
  const storageLocation = await storageManager.uploadContent({
    provider: 'S3',
    key: storageKey,
    content: buffer,
    mimeType: 'application/pdf',
    size: buffer.length,
    visibility: 'PRIVATE',
    organizationId,
  })

  const mediaAssetService = new MediaAssetService(organizationId, actorId, db)
  const { asset } = await mediaAssetService.createWithVersion(
    {
      kind: 'DOCUMENT',
      purpose: 'PREVIEW',
      name: fileName,
      mimeType: 'application/pdf',
      size: BigInt(buffer.length),
      isPrivate: true,
      organizationId,
      createdById: actorId,
    },
    storageLocation.id
  )

  await db
    .update(schema.MediaAsset)
    .set({ expiresAt: new Date(Date.now() + REPORT_ASSET_TTL_MS) })
    .where(eq(schema.MediaAsset.id, asset.id))

  return { assetId: asset.id, fileName }
}
