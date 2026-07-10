// packages/lib/src/documents/index.ts
//
// Server-only entrypoint for quote/invoice PDF rendering (money MQ2 build spec §B/§C;
// invoice composition in MI1 §H) — settings resolution, payload building + content hashing,
// react-pdf rendering, and the render-or-reuse MediaAsset service. No `/client` variant:
// `@react-pdf/renderer` and the storage/media-asset layers are server-only (the `./jobs`
// recipe).

export {
  type DocumentType,
  type EnsureDocumentPdfResult,
  type EnsureQuotePdfResult,
  ensureDocumentPdf,
  ensureDocumentPdfViaQueue,
  ensureQuotePdf,
  ensureQuotePdfViaQueue,
} from './ensure-pdf'
export {
  buildInvoicePdfPayload,
  buildQuotePdfPayload,
  type DocumentPdfPayload,
  type InvoicePdfPayload,
  type InvoicePdfPaymentRow,
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
