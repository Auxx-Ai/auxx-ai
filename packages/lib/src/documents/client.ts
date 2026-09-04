// packages/lib/src/documents/client.ts
//
// Client-safe document-type descriptors (plans/printing/01-unified-print.md §A) — no
// react-pdf/server imports, constants only. Lets the print wizard know which entities offer
// "Document" print style and what extra options to render, without pulling in server-only
// code (`./registry`, `@react-pdf/renderer`, storage). Deliberately has NO 'use client'
// directive: this module only exports constants/types, and a directive on a constants-only
// lib client.ts turns its exports into proxy stubs for server importers (see the registry
// gotcha in project memory).

/**
 * One wizard-renderable print option a registered document type contributes (invoice's
 * copies/collation/sortBy from P4 on). Rendered generically by the print wizard via
 * `FieldPanelRow`/`FieldInputAdapter` — no per-type wizard UI code needed.
 */
export type PrintOptionField =
  | { type: 'toggle'; key: string; label: string; default: boolean }
  | {
      type: 'select'
      key: string
      label: string
      options: Array<{ label: string; value: string }>
      default: string
    }
  | {
      type: 'multi-select'
      key: string
      label: string
      options: Array<{ label: string; value: string }>
      default: string[]
    }

/**
 * Every registered document type's id — the single literal union `DocumentType`
 * (`./ensure-pdf.ts`) is derived from, so that union never has to be hand-maintained.
 *
 * {@link DocumentTypeDescriptor.id} is typed as this union rather than `string`, which is
 * what keeps `DOCUMENT_TYPE_DESCRIPTORS`' ids literal: a plain `id: string` widens them and
 * any derivation off the array yields `string`. Adding a document type therefore means
 * adding its id here, a descriptor below, and an entry in `./registry.ts`'s
 * `RENDER_ENTRIES` — a descriptor whose id is not in this union does not compile.
 *
 * ⚠️ `as const satisfies readonly DocumentTypeDescriptor[]` on the array below is the more
 * obvious way to keep the ids literal and was tried first. It forces `printOptions` (and the
 * nested `options`/`default` arrays) readonly, and `print-document-content-page.tsx` in
 * `apps/web` declares its prop as a mutable `PrintOptionField[]` — so it costs two TS4104s
 * there plus one where `registry.ts` merges the descriptor in. This union is the same
 * guarantee with no ripple.
 */
export type DocumentTypeId = 'quote' | 'invoice' | 'purchase_order' | 'bank_deposit'

/**
 * Client-safe shape of a registered document type — enough for the print wizard to decide
 * whether "Document" style is available for the current entity and which extra fields to
 * render, without importing the server-only registry (`./registry.ts`).
 */
export interface DocumentTypeDescriptor {
  /** Matches `RegisteredDocumentType.id`. */
  id: DocumentTypeId
  /** `EntityDefinition.entityType` slug this document type renders records of — NOT the
   * per-org generated `EntityDefinition.id`; callers resolve/compare via the entity's
   * `entityType` (client `Resource.entityType`, server `requireCachedEntityDefId`). */
  entityType: string
  /** Type-specific extras ONLY — `copies`/`collation` are CORE `document` print-config fields
   * the wizard renders for every document type; this carries the rest (invoice's `sortBy`).
   * Values land in `printConfig.document.options`. Empty for quote (P4). */
  printOptions: PrintOptionField[]
}

/**
 * All document types registered for "Document" print style. Single source of truth for
 * id/entityType — the server registry (`./registry.ts`) imports this array and merges
 * it with its `buildPayload`/`Pdf` wiring rather than redeclaring the ids.
 */
export const DOCUMENT_TYPE_DESCRIPTORS: DocumentTypeDescriptor[] = [
  { id: 'quote', entityType: 'quote', printOptions: [] },
  {
    id: 'invoice',
    entityType: 'invoice',
    printOptions: [
      {
        type: 'select',
        key: 'sortBy',
        label: 'Sort by',
        options: [
          { label: 'Number', value: 'number' },
          { label: 'Date', value: 'date' },
          { label: 'Contact', value: 'contact' },
        ],
        default: 'number',
      },
    ],
  },
  // The buy-side document (plans/purchasing/07 §1.2). No `printOptions`: the invoice's
  // `sortBy` exists for stacks of customer statements, and nothing in the batch-print flow
  // sorts purchase orders by anything but their number yet.
  { id: 'purchase_order', entityType: 'purchase_order', printOptions: [] },
  // The deposit slip (plans/accounting/ui-plan.md §5.3). An INTERNAL document: it is carried
  // to a bank teller or filed against the statement, never emailed to anybody, which is why
  // it contributes no `printOptions` and why its send profile in `money/send-email.ts`
  // refuses rather than mailing.
  { id: 'bank_deposit', entityType: 'bank_deposit', printOptions: [] },
]
