// packages/lib/src/documents/registry.ts
//
// Document-type registry (plans/printing/01-unified-print.md §A) — replaces the hardcoded
// `'quote' | 'invoice'` dispatch that used to live inline in `render.ts`'s `documentType`
// ternary and `ensure-pdf.ts`'s `POINTER_ATTR` map. A static, statically-imported map (no
// side-effect self-registration / import-order magic): adding a document type means adding
// an entry to `RENDER_ENTRIES` below plus a descriptor in `./client.ts`.

import type { RecordId } from '@auxx/types/resource'
import type { ComponentType } from 'react'
import { DOCUMENT_TYPE_DESCRIPTORS, type DocumentTypeId, type PrintOptionField } from './client'
import {
  buildInvoicePdfPayload,
  buildPurchaseOrderPdfPayload,
  buildQuotePdfPayload,
  type DocumentPdfPayload,
} from './payload'
import { InvoicePdf } from './pdf/invoice-pdf'
import { PurchaseOrderPdf } from './pdf/purchase-order-pdf'
import { QuotePdf } from './pdf/quote-pdf'

/**
 * A document type pluggable into the render (`render.ts`), render-or-reuse (`ensure-pdf.ts`),
 * and (from P4 on) batch-print pipelines. This is THE hook for "customizable based on system
 * type" the print wizard's Document style relies on.
 */
export interface RegisteredDocumentType {
  /** Matches `DocumentType` and the client descriptor's `id` — one union, declared in
   * `./client.ts` so the client-safe half owns it. */
  id: DocumentTypeId
  /** `EntityDefinition.entityType` slug this document type renders records of — resolve to a
   * per-org `EntityDefinition.id` via `requireCachedEntityDefId` before comparing against one. */
  entityType: string
  /** systemAttribute of the last-rendered pdf-asset pointer field (`ensure-pdf.ts`). */
  pointerAttr: string
  buildPayload(params: {
    organizationId: string
    userId: string
    recordId: RecordId
  }): Promise<{ payload: DocumentPdfPayload; hash: string }>
  /**
   * react-pdf component. `copyLabel` renders as/next to the document label in the header for
   * batch print runs (P4) — "Office Copy" for the office copy, `undefined` for the customer
   * copy and every single-document render (`ensure-pdf.ts`, `preview-pdf.ts`).
   */
  Pdf: ComponentType<{
    payload: DocumentPdfPayload
    logoBytes?: Buffer | null
    /** Resolved+downscaled bytes for every payload photo ref that resolved successfully,
     * keyed by ref (plan 37b §5) — a ref with no entry means resolution failed and the
     * component must skip it silently, same contract as `logoBytes`. */
    photoBytes?: Map<string, Buffer>
    copyLabel?: string
  }>
  /** Wizard extras this type contributes (P4 — empty today, see `./client.ts`). */
  printOptions?: PrintOptionField[]
}

/** Per-type renderer wiring — the part `./client.ts`'s descriptors can't carry (react-pdf +
 * server-only payload builders). Merged with `DOCUMENT_TYPE_DESCRIPTORS` below so
 * id/entityType are defined exactly once.
 *
 * ⚠️ `pointerAttr` is not optional in practice, even though nothing throws without it.
 * `ensure-pdf.ts` reads the pointer to decide whether a cached render can be reused; when the
 * org has no such field the lookup simply returns nothing, so every send re-renders AND mints
 * a fresh `MediaAsset` rather than versioning the existing one. That is an asset leak with no
 * error attached, which is why a new entry names a real field and never a plausible one. */
const RENDER_ENTRIES: Array<
  Pick<RegisteredDocumentType, 'id' | 'pointerAttr' | 'buildPayload' | 'Pdf'>
> = [
  {
    id: 'quote',
    pointerAttr: 'quote_pdf_asset',
    buildPayload: (params) =>
      buildQuotePdfPayload({
        organizationId: params.organizationId,
        userId: params.userId,
        quoteRecordId: params.recordId,
      }),
    Pdf: QuotePdf as unknown as RegisteredDocumentType['Pdf'],
  },
  {
    id: 'invoice',
    pointerAttr: 'invoice_pdf_asset',
    buildPayload: (params) =>
      buildInvoicePdfPayload({
        organizationId: params.organizationId,
        userId: params.userId,
        invoiceRecordId: params.recordId,
      }),
    Pdf: InvoicePdf as unknown as RegisteredDocumentType['Pdf'],
  },
  {
    id: 'purchase_order',
    pointerAttr: 'purchase_order_pdf_asset',
    buildPayload: (params) =>
      buildPurchaseOrderPdfPayload({
        organizationId: params.organizationId,
        userId: params.userId,
        purchaseOrderRecordId: params.recordId,
      }),
    Pdf: PurchaseOrderPdf as unknown as RegisteredDocumentType['Pdf'],
  },
]

const REGISTRY: Record<string, RegisteredDocumentType> = Object.fromEntries(
  RENDER_ENTRIES.map((entry) => {
    const descriptor = DOCUMENT_TYPE_DESCRIPTORS.find((d) => d.id === entry.id)
    if (!descriptor) {
      throw new Error(`No client descriptor registered for document type "${entry.id}"`)
    }
    const registered: RegisteredDocumentType = {
      ...entry,
      entityType: descriptor.entityType,
      printOptions: descriptor.printOptions,
    }
    return [entry.id, registered]
  })
)

/** Look up a registered document type by id ('quote' | 'invoice'). */
export function getDocumentType(id: string): RegisteredDocumentType | undefined {
  return REGISTRY[id]
}

/** All registered document types, in registration order. */
export function listDocumentTypes(): RegisteredDocumentType[] {
  return Object.values(REGISTRY)
}

/**
 * Look up the registered document type for an entity's `entityType` slug — e.g. a
 * records-page bulk action deciding whether the "Document" print style card should be enabled.
 */
export function getDocumentTypeByEntityType(
  entityType: string
): RegisteredDocumentType | undefined {
  return listDocumentTypes().find((d) => d.entityType === entityType)
}
