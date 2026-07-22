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
 * Client-safe shape of a registered document type — enough for the print wizard to decide
 * whether "Document" style is available for the current entity and which extra fields to
 * render, without importing the server-only registry (`./registry.ts`).
 */
export interface DocumentTypeDescriptor {
  /** Matches `RegisteredDocumentType.id` ('quote' | 'invoice'). */
  id: string
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
]
