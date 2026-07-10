// packages/lib/src/documents/index.ts
//
// Server-only entrypoint for quote/invoice PDF rendering (money MQ2 build spec §B/§C) —
// settings resolution, payload building + content hashing, react-pdf rendering, and the
// render-or-reuse MediaAsset service. No `/client` variant: `@react-pdf/renderer` and the
// storage/media-asset layers are server-only (the `./jobs` recipe).

export { type EnsureQuotePdfResult, ensureQuotePdf, ensureQuotePdfViaQueue } from './ensure-pdf'
export {
  buildQuotePdfPayload,
  type QuotePdfContact,
  type QuotePdfLineItem,
  type QuotePdfPayload,
  SAMPLE_QUOTE_PDF_PAYLOAD,
} from './payload'
export { type RenderPreviewQuotePdfResult, renderPreviewQuotePdf } from './preview-pdf'
export { renderDocumentPdf } from './render'
export {
  type DocumentBrandingSettings,
  type DocumentBusinessSettings,
  type DocumentInvoiceSettings,
  type DocumentLogo,
  type DocumentQuoteSettings,
  type ResolvedDocumentSettings,
  resolveDocumentSettings,
} from './resolve-settings'
