// packages/lib/src/documents/registry.ts
//
// Document-type registry (plans/printing/01-unified-print.md §A) — replaces the hardcoded
// `'quote' | 'invoice'` dispatch that used to live inline in `render.ts`'s `documentType`
// ternary and `ensure-pdf.ts`'s `POINTER_ATTR` map. A static, statically-imported map (no
// side-effect self-registration / import-order magic): adding a document type means adding
// an entry to `RENDER_ENTRIES` below plus a descriptor in `./client.ts`.

import type { RecordId } from '@auxx/types/resource'
import type { ComponentType } from 'react'
import { DOCUMENT_TYPE_DESCRIPTORS, type PrintOptionField } from './client'
import { buildInvoicePdfPayload, buildQuotePdfPayload, type DocumentPdfPayload } from './payload'
import { InvoicePdf } from './pdf/invoice-pdf'
import { QuotePdf } from './pdf/quote-pdf'

/**
 * A document type pluggable into the render (`render.ts`), render-or-reuse (`ensure-pdf.ts`),
 * and (from P4 on) batch-print pipelines. This is THE hook for "customizable based on system
 * type" the print wizard's Document style relies on.
 */
export interface RegisteredDocumentType {
  /** Matches `DocumentType` ('quote' | 'invoice') and the client descriptor's `id`. */
  id: string
  /** `EntityDefinition.id` this document type renders records of. */
  entityDefinitionId: string
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
  Pdf: ComponentType<{ payload: DocumentPdfPayload; logoBytes?: Buffer | null; copyLabel?: string }>
  /** Wizard extras this type contributes (P4 — empty today, see `./client.ts`). */
  printOptions?: PrintOptionField[]
}

/** Per-type renderer wiring — the part `./client.ts`'s descriptors can't carry (react-pdf +
 * server-only payload builders). Merged with `DOCUMENT_TYPE_DESCRIPTORS` below so
 * id/entityDefinitionId are defined exactly once. */
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
]

const REGISTRY: Record<string, RegisteredDocumentType> = Object.fromEntries(
  RENDER_ENTRIES.map((entry) => {
    const descriptor = DOCUMENT_TYPE_DESCRIPTORS.find((d) => d.id === entry.id)
    if (!descriptor) {
      throw new Error(`No client descriptor registered for document type "${entry.id}"`)
    }
    const registered: RegisteredDocumentType = {
      ...entry,
      entityDefinitionId: descriptor.entityDefinitionId,
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
 * Look up the registered document type for an entity definition — e.g. a records-page bulk
 * action deciding whether the "Document" print style card should be enabled.
 */
export function getDocumentTypeByEntityDefinitionId(
  entityDefinitionId: string
): RegisteredDocumentType | undefined {
  return listDocumentTypes().find((d) => d.entityDefinitionId === entityDefinitionId)
}
