// packages/lib/src/resources/registry/resources/invoice-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/** Invoice lifecycle status (README §domain, money MI1 build spec §B.1). */
export const INVOICE_STATUS_OPTIONS = [
  { label: 'Draft', value: 'draft', color: 'gray' },
  { label: 'Sent', value: 'sent', color: 'blue' },
  { label: 'Partially paid', value: 'partially_paid', color: 'amber' },
  { label: 'Paid', value: 'paid', color: 'green' },
  { label: 'Void', value: 'void', color: 'gray' },
] as const

const INVOICE_BILLING_KIND_OPTIONS = [
  { label: 'Full contract', value: 'full_contract', color: 'green' },
  { label: 'Progress', value: 'progress', color: 'purple' },
  { label: 'Visit', value: 'visit', color: 'blue' },
  { label: 'Recurring flat', value: 'recurring_flat', color: 'teal' },
  { label: 'Extra work', value: 'extra_work', color: 'amber' },
  { label: 'Standalone', value: 'standalone', color: 'gray' },
] as const

/** Percent-of-subtotal vs flat-amount discount — same shape as the quote's. */
const INVOICE_DISCOUNT_TYPE_OPTIONS = [
  { label: 'Percent', value: 'percent', color: 'blue' },
  { label: 'Amount', value: 'amount', color: 'purple' },
] as const

/**
 * Field definitions for the Invoice resource (money MI1, README).
 * Visible, drawer-only system def (`hasDetailPage: false` — 01-ui #10 lock).
 */
export const INVOICE_FIELDS: Record<string, ResourceField> = {
  id: {
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'id',
    systemSortOrder: 'a0',
    showInPanel: false,
    dbColumn: 'id',
    nullable: false,
    isIdentifier: true,
    operatorOverrides: ['is', 'is not', 'in', 'not in'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique invoice identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'invoice_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // hook-generated (§F.2) — the hook is the ONLY writer
      updatable: false,
      configurable: false,
    },
    description: 'Auto-generated invoice number',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'invoice_status',
    systemSortOrder: 'a2',
    nullable: false,
    options: { options: [...INVOICE_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'draft',
  },

  contact: {
    id: toFieldId('contact'),
    key: 'contact',
    label: 'Contact',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'invoice_contact',
    systemSortOrder: 'a3',
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'contact:invoices' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'contact',
      relationshipType: 'belongs_to',
      inverseName: 'Invoices',
      inverseSystemAttribute: 'contact_invoices',
    },
    description: 'Customer contact for this invoice — required, the billing party',
  },

  workOrder: {
    id: toFieldId('workOrder'),
    key: 'workOrder',
    label: 'Work Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'invoice_work_order',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'work_order:invoices' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'work_order',
      relationshipType: 'belongs_to',
      inverseName: 'Invoices',
      inverseSystemAttribute: 'work_order_invoices',
    },
    description: 'Job this invoice was gathered from — optional, standalone invoices have none',
  },

  issuedAt: {
    id: toFieldId('issuedAt'),
    key: 'issuedAt',
    label: 'Issued',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'invoice_issued_at',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select issue date',
    description: 'Prefilled today at create; stamped by mark-sent if empty (§G.2)',
  },

  dueDate: {
    id: toFieldId('dueDate'),
    key: 'dueDate',
    label: 'Due Date',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'invoice_due_date',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select due date',
    description: 'Overdue badge derives from this (UI-side) — never a status',
  },

  discountType: {
    id: toFieldId('discountType'),
    key: 'discountType',
    label: 'Discount Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'invoice_discount_type',
    systemSortOrder: 'a7',
    showInPanel: false, // shown in the line-items overview card below
    nullable: true,
    options: { options: [...INVOICE_DISCOUNT_TYPE_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select discount type',
    description: 'Null = no discount',
  },

  discountValue: {
    id: toFieldId('discountValue'),
    key: 'discountValue',
    label: 'Discount Value',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'invoice_discount_value',
    systemSortOrder: 'a8',
    showInPanel: false, // shown in the line-items overview card below
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  taxName: {
    id: toFieldId('taxName'),
    key: 'taxName',
    label: 'Tax Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'invoice_tax_name',
    systemSortOrder: 'a9',
    showInTable: false, // shown in the panel, hidden from default table columns
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: "Snapshot of the picked tax rate's name (documents.taxRates)",
  },

  taxRate: {
    id: toFieldId('taxRate'),
    key: 'taxRate',
    label: 'Tax Rate',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'invoice_tax_rate',
    systemSortOrder: 'aA',
    showInPanel: false, // shown in the line-items overview card below
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Snapshot of the picked tax rate, percent (e.g. 7.5)',
  },

  subtotal: {
    id: toFieldId('subtotal'),
    key: 'subtotal',
    label: 'Subtotal',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'invoice_subtotal',
    systemSortOrder: 'aB',
    showInPanel: false, // shown in the line-items overview card below
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // totals engine (§G.1) is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Sum of line totals — written by the totals engine hook',
  },

  taxTotal: {
    id: toFieldId('taxTotal'),
    key: 'taxTotal',
    label: 'Tax Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'invoice_tax_total',
    systemSortOrder: 'aC',
    showInPanel: false, // shown in the line-items overview card below
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // totals engine (§G.1) is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Written by the totals engine hook',
  },

  total: {
    id: toFieldId('total'),
    key: 'total',
    label: 'Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'invoice_total',
    systemSortOrder: 'aD',
    showInPanel: false, // shown in the line-items overview card below
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // totals engine (§G.1) is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Written by the totals engine hook',
  },

  amountPaid: {
    id: toFieldId('amountPaid'),
    key: 'amountPaid',
    label: 'Amount Paid',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'invoice_amount_paid',
    systemSortOrder: 'aE',
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // ledger sync (§E.4) is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Sum of succeeded payments — written by syncInvoicePaymentState',
  },

  balance: {
    id: toFieldId('balance'),
    key: 'balance',
    label: 'Balance',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'invoice_balance',
    systemSortOrder: 'aF',
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // ledger sync (§E.4) is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'total - amountPaid — written by syncInvoicePaymentState',
  },

  notes: {
    id: toFieldId('notes'),
    key: 'notes',
    label: 'Notes',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'invoice_notes',
    systemSortOrder: 'aG',
    showInTable: false, // long-form; shown in the panel, hidden from default table columns
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter internal notes',
    description: 'Internal notes — not shown to the customer',
  },

  terms: {
    id: toFieldId('terms'),
    key: 'terms',
    label: 'Terms',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'invoice_terms',
    systemSortOrder: 'aH',
    showInTable: false, // shown in the panel, hidden from default table columns
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter customer-facing terms',
    description: 'Customer-facing terms (plain text, PDF-friendly)',
  },

  photos: {
    id: toFieldId('photos'),
    key: 'photos',
    label: 'Photos',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'invoice_photos',
    systemSortOrder: 'aH1',
    nullable: true,
    options: {
      file: { allowMultiple: true, allowedFileTypes: ['image'], maxFiles: 10 },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Photos attached directly to this invoice (plan 37b scouting build spec) — no ' +
      'auto-copy from quote_photos',
  },

  // The last-rendered invoice PDF, as a single FILE value
  // (plans/purchasing/08-documents-on-records.md P19/P20). Written ONLY by
  // `ensureDocumentPdf`; `updatable: false` is what keeps every human door shut —
  // it is read by the grid cell, the panel, the dialogs and connector writability,
  // and NOT by the field-value write path, so the renderer is unaffected
  // (the `079-enrichment-fields-backend-owned` shape).
  //
  // 🛑 Never make this user-writable. `ensureDocumentPdf` reads the pointer, loads
  // that MediaAsset and appends a new VERSION to it whenever the content hash
  // disagrees. A file a person uploaded has no `contentHash` at all, so the
  // comparison always fails and the next send would silently republish their file
  // as our PDF.
  pdfAsset: {
    id: toFieldId('pdfAsset'),
    key: 'pdfAsset',
    label: 'Invoice PDF',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'invoice_pdf_asset',
    systemSortOrder: 'aK',
    showInPanel: false,
    nullable: true,
    options: {
      file: { allowMultiple: false, maxFiles: 1, allowedFileTypes: ['document'] },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
      hidden: true,
    },
    description:
      'The generated invoice PDF ({ ref: "asset:<MediaAsset id>" }) — written only by ' +
      'ensureDocumentPdf, surfaced read-only through the documents card, never user-editable',
  },

  lineItems: {
    id: toFieldId('lineItems'),
    key: 'lineItems',
    label: 'Line Items',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'invoice_line_items',
    systemSortOrder: 'aJ',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'line_item:invoice' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Line items on this invoice',
  },

  payments: {
    id: toFieldId('payments'),
    key: 'payments',
    label: 'Payments',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'invoice_payments',
    systemSortOrder: 'aK',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'payment:invoice' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Payment mirror records for this invoice (ledger-backed, §E)',
  },

  publicToken: {
    id: toFieldId('publicToken'),
    key: 'publicToken',
    label: 'Public Token',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'invoice_public_token',
    systemSortOrder: 'aL',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
      hidden: true,
    },
    description:
      'Unguessable capability token for the public /pay/{token} page (money MP1 build spec ' +
      '§H) — lazily minted by ensureInvoicePublicToken on first send/PDF-render, never ' +
      'user-editable. Mirrors the invoice_pdf_asset recipe (FieldValueService-only writer).',
  },

  billingKind: {
    id: toFieldId('billingKind'),
    key: 'billingKind',
    label: 'Billing Kind',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'invoice_billing_kind',
    systemSortOrder: 'aM',
    showInPanel: false,
    nullable: false,
    options: { options: [...INVOICE_BILLING_KIND_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    defaultValue: 'standalone',
    description: 'Read-only billing intent for this invoice snapshot',
  },
  servicePeriodStart: {
    id: toFieldId('servicePeriodStart'),
    key: 'servicePeriodStart',
    label: 'Service Period Start',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'invoice_service_period_start',
    systemSortOrder: 'aN',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
  },
  servicePeriodEnd: {
    id: toFieldId('servicePeriodEnd'),
    key: 'servicePeriodEnd',
    label: 'Service Period End',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'invoice_service_period_end',
    systemSortOrder: 'aO',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
  },
  visitCount: {
    id: toFieldId('visitCount'),
    key: 'visitCount',
    label: 'Visit Count',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'invoice_visit_count',
    systemSortOrder: 'aP',
    showInPanel: false,
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    defaultValue: 0,
  },
  progressPercent: {
    id: toFieldId('progressPercent'),
    key: 'progressPercent',
    label: 'Progress Percent',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'invoice_progress_percent',
    systemSortOrder: 'aQ',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
  },
  installmentName: {
    id: toFieldId('installmentName'),
    key: 'installmentName',
    label: 'Installment Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'invoice_installment_name',
    systemSortOrder: 'aR',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'b0',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the invoice is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'b1',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the invoice is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
