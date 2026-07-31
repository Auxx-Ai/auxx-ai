// packages/lib/src/documents/preview-pdf.ts

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { MediaAssetService } from '../files/core/media-asset-service'
import { createStorageManager } from '../files/storage/storage-manager'
import { SAMPLE_QUOTE_PDF_PAYLOAD } from './payload'
import { renderDocumentPdf } from './render'
import { resolveDocumentSettings } from './resolve-settings'

/** A preview render lives an hour — long enough to open in a new tab, short enough not to pile up. */
const PREVIEW_ASSET_TTL_MS = 60 * 60 * 1000

export interface RenderPreviewQuotePdfResult {
  assetId: string
  fileName: string
}

/**
 * Render the hardcoded sample quote (`SAMPLE_QUOTE_PDF_PAYLOAD`) merged with the org's
 * CURRENT SAVED document settings (money MQ2 build spec §F.4 "Preview PDF"). Unlike
 * `ensureQuotePdf`, this never touches a real quote's `pdfAsset` pointer or content-hash
 * cache — every call renders fresh and uploads a short-lived `MediaAsset` (`expiresAt`
 * ~1h) so the Documents-settings page can open it via the same download proxy route
 * (`GET /api/files/download/asset:<id>`) without inventing a second download path.
 */
export async function renderPreviewQuotePdf(params: {
  organizationId: string
  actorId: string
}): Promise<RenderPreviewQuotePdfResult> {
  const { organizationId, actorId } = params

  const settings = await resolveDocumentSettings(organizationId)
  const payload = { ...SAMPLE_QUOTE_PDF_PAYLOAD, organizationId, settings }
  const buffer = await renderDocumentPdf(payload)

  const fileName = 'quote-preview.pdf'
  const storageManager = createStorageManager(organizationId)
  const storageKey = `documents/${organizationId}/preview/${Date.now()}.pdf`
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
      size: buffer.length,
      isPrivate: true,
      organizationId,
      createdById: actorId,
    },
    storageLocation.id
  )

  await db
    .update(schema.MediaAsset)
    .set({ expiresAt: new Date(Date.now() + PREVIEW_ASSET_TTL_MS) })
    .where(eq(schema.MediaAsset.id, asset.id))

  return { assetId: asset.id, fileName }
}
