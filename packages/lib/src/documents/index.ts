// packages/lib/src/documents/index.ts
//
// Server-only entrypoint for quote/invoice PDF rendering (money MQ2 build spec §B/§C;
// invoice composition in MI1 §H) — settings resolution, payload building + content hashing,
// react-pdf rendering, the render-or-reuse MediaAsset service, and the document-type registry
// (plans/printing/01-unified-print.md §A). `@react-pdf/renderer` and the storage/media-asset
// layers are server-only (the `./jobs` recipe) — client code that only needs to know which
// entities offer "Document" print style should import `./client` instead.

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
  loadPdfContact,
  type PdfPhotoRef,
  type QuotePdfContact,
  type QuotePdfLineItem,
  type QuotePdfPayload,
  SAMPLE_QUOTE_PDF_PAYLOAD,
} from './payload'
export { type RenderPreviewQuotePdfResult, renderPreviewQuotePdf } from './preview-pdf'
export {
  getDocumentType,
  getDocumentTypeByEntityDefinitionId,
  listDocumentTypes,
  type RegisteredDocumentType,
} from './registry'
export { type RenderDocumentPdfOptions, renderDocumentPdf, resolvePhotoRef } from './render'
export {
  type DocumentBrandingSettings,
  type DocumentBusinessSettings,
  type DocumentInvoiceSettings,
  type DocumentLogo,
  type DocumentQuoteSettings,
  type ResolvedDocumentSettings,
  resolveDocumentSettings,
} from './resolve-settings'
