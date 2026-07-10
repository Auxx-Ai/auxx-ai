// packages/lib/src/documents/render.ts

import type { DocumentProps } from '@react-pdf/renderer'
import { renderToBuffer } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import { MediaAssetService } from '../files/core/media-asset-service'
import type { DocumentPdfPayload } from './payload'
import { InvoicePdf } from './pdf/invoice-pdf'
import { QuotePdf } from './pdf/quote-pdf'

/**
 * Render a quote/invoice payload to a PDF buffer (money MQ2 build spec §B.2/§C.3; MI1 §H.1
 * adds the invoice branch). Loads the org's logo bytes server-side via
 * `MediaAssetService.getContent` — react-pdf's `<Image>` always receives a Buffer, never a
 * URL (02-document-settings.md renderer contract: signed-URL/public-bucket headaches inside
 * the worker). A missing/deleted logo asset renders the document without a logo rather than
 * failing the whole PDF.
 */
export async function renderDocumentPdf(payload: DocumentPdfPayload): Promise<Buffer> {
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

  // `renderToBuffer` types its argument as `ReactElement<DocumentProps>` (the root
  // `<Document>`) — `QuotePdf`/`InvoicePdf` are components that RETURN one, which react-pdf's
  // reconciler resolves like any host tree, but the surface types don't model that.
  const element =
    payload.documentType === 'invoice'
      ? createElement(InvoicePdf, { payload, logoBytes })
      : createElement(QuotePdf, { payload, logoBytes })
  return renderToBuffer(element as unknown as ReactElement<DocumentProps>)
}
