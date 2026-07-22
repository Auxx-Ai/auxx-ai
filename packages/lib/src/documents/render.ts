// packages/lib/src/documents/render.ts

import type { DocumentProps } from '@react-pdf/renderer'
import { renderToBuffer } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import { FileService } from '../files/core/file-service'
import { MediaAssetService } from '../files/core/media-asset-service'
import { THUMBNAIL_LIMITS } from '../files/core/thumbnail-types'
import type { DocumentPdfPayload } from './payload'
import { getDocumentType } from './registry'

/** Longest-edge cap (points→px, effectively pixels here) for embedded photo bytes (plan 37b
 * §5) — a 12-photo quote at full camera resolution would otherwise balloon the PDF to tens
 * of MB. 1200px is comfortably above what a ~110pt line thumbnail or a half-page 2-up grid
 * cell ever needs at print resolution. */
const PHOTO_MAX_DIMENSION = 1200

/** JPEG quality for embedded photos — react-pdf only embeds JPEG/PNG, so every source format
 * (including already-JPEG originals) is re-encoded here; 80 keeps file size down without
 * visible banding at thumbnail/gallery sizes. */
const PHOTO_JPEG_QUALITY = 80

/**
 * Downscale + transcode one photo's raw bytes to a PDF-embeddable JPEG (plan 37b §5). Mirrors
 * the resize/encode shape of `files/core/image-processing.ts`'s `processImage`, but as a
 * one-off (no thumbnail preset/DB row) since these bytes are only ever embedded inline in a
 * rendered PDF buffer, never stored.
 */
async function downscalePhotoForPdf(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  return sharp(buffer, { limitInputPixels: THUMBNAIL_LIMITS.maxInputPixels, failOn: 'warning' })
    .rotate() // auto-orient by EXIF before resizing, same as the thumbnail pipeline
    .resize(PHOTO_MAX_DIMENSION, PHOTO_MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: PHOTO_JPEG_QUALITY, progressive: true, mozjpeg: true })
    .toBuffer()
}

/**
 * Resolve one payload photo ref (`"asset:<id>"` | `"file:<id>"`) to downscaled JPEG bytes.
 * `asset:` refs are `MediaAsset` rows (uploaded via the FILE field's asset-upload path);
 * `file:` refs are `FolderFile` rows (picked from the file manager) — both services implement
 * the same `ContentAccessible.getContent(id) => Buffer` shape (`files/core/mixins`), so the
 * only branch is which service to construct. Returns `null` on any failure (deleted asset,
 * unreadable image, transient storage error) — callers skip the ref silently, same fail-soft
 * contract as the logo above.
 *
 * Exported (plan 37b §6) for the public `/quote/[token]/photo/[ref]` and
 * `/pay/[token]/photo/[ref]` route handlers — same downscale-on-read behavior the PDF gets,
 * so the public pages never stream multi-MB originals. Callers MUST only invoke this after
 * verifying the ref appears in that document's own (already internal-filtered) payload — this
 * function itself has no allow-list, it resolves any well-formed ref for the given org.
 */
export async function resolvePhotoRef(organizationId: string, ref: string): Promise<Buffer | null> {
  try {
    const colonIdx = ref.indexOf(':')
    if (colonIdx === -1) return null
    const kind = ref.slice(0, colonIdx)
    const id = ref.slice(colonIdx + 1)

    let raw: Buffer
    if (kind === 'asset') {
      raw = await new MediaAssetService(organizationId).getContent(id)
    } else if (kind === 'file') {
      raw = await new FileService(organizationId).getContent(id)
    } else {
      return null
    }

    return await downscalePhotoForPdf(raw)
  } catch {
    return null
  }
}

/**
 * Resolve every photo ref referenced by a document payload (header-level `photos` + each
 * line's `photos`) to downscaled JPEG bytes, keyed by ref (plan 37b §5). Refs repeat when the
 * same asset appears on multiple lines (e.g. a copied line) or is somehow duplicated — the
 * `Set` dedupes so each unique ref is only fetched/downscaled once. Counts are small (≤10
 * header + ≤10 per line) so an unbounded `Promise.all` is fine; a ref that fails to resolve
 * is simply absent from the returned map, and every PDF photo component skips refs with no
 * entry (same missing/broken-ref contract as the logo).
 */
async function resolvePayloadPhotoBytes(payload: DocumentPdfPayload): Promise<Map<string, Buffer>> {
  const refs = new Set<string>()
  for (const photo of payload.photos ?? []) refs.add(photo.ref)
  for (const line of payload.lines) {
    for (const photo of line.photos ?? []) refs.add(photo.ref)
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

/** Options accepted by {@link renderDocumentPdf} beyond the payload itself. */
export interface RenderDocumentPdfOptions {
  /** Renders as/next to the document-type label in the header (P4 batch printing — "Office
   * Copy"). Header label ONLY — no watermark/tint (plans/printing/01-unified-print.md locked
   * decision 4). `undefined`/omitted renders the header exactly as before (existing single-doc
   * callers — `ensure-pdf.ts`, `preview-pdf.ts` — are unaffected). */
  copyLabel?: string
}

/**
 * Render a quote/invoice payload to a PDF buffer (money MQ2 build spec §B.2/§C.3; MI1 §H.1
 * adds the invoice branch). Loads the org's logo bytes server-side via
 * `MediaAssetService.getContent` — react-pdf's `<Image>` always receives a Buffer, never a
 * URL (02-document-settings.md renderer contract: signed-URL/public-bucket headaches inside
 * the worker). A missing/deleted logo asset renders the document without a logo rather than
 * failing the whole PDF.
 */
export async function renderDocumentPdf(
  payload: DocumentPdfPayload,
  options?: RenderDocumentPdfOptions
): Promise<Buffer> {
  const logoAssetId = payload.settings.branding.logo?.assetId
  let logoBytes: Buffer | null = null

  if (logoAssetId) {
    try {
      const mediaAssetService = new MediaAssetService(payload.organizationId)
      logoBytes = await mediaAssetService.getContent(logoAssetId)
    } catch {
      logoBytes = null
    }
  }

  const photoBytes = await resolvePayloadPhotoBytes(payload)

  const documentType = getDocumentType(payload.documentType)
  if (!documentType) {
    throw new Error(`Unregistered document type: ${payload.documentType}`)
  }

  // `renderToBuffer` types its argument as `ReactElement<DocumentProps>` (the root
  // `<Document>`) — `QuotePdf`/`InvoicePdf` are components that RETURN one, which react-pdf's
  // reconciler resolves like any host tree, but the surface types don't model that.
  const element = createElement(documentType.Pdf, {
    payload,
    logoBytes,
    photoBytes,
    copyLabel: options?.copyLabel,
  })
  return renderToBuffer(element as unknown as ReactElement<DocumentProps>)
}
