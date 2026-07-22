// packages/lib/src/documents/render.ts

import type { DocumentProps } from '@react-pdf/renderer'
import { renderToBuffer } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import { MediaAssetService } from '../files/core/media-asset-service'
import type { DocumentPdfPayload } from './payload'
import { getDocumentType } from './registry'

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
    copyLabel: options?.copyLabel,
  })
  return renderToBuffer(element as unknown as ReactElement<DocumentProps>)
}
