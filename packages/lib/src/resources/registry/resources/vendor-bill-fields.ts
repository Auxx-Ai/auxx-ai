// packages/lib/src/resources/registry/resources/vendor-bill-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { VendorBillPaidSource, VendorBillStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Vendor Bill resource — the third leg of the
 * three-way match (plans/purchasing/01-build-plan.md §5.1–5.3), beside the
 * purchase order (what we agreed to buy) and the stock movement (what actually
 * turned up on the dock).
 *
 * Visible system def with `hasDetailPage: false` — the **invoice** shape, drawer
 * only. A bill *records* something already settled elsewhere; it is not built or
 * iterated the way a purchase order is, and the exception queue is a filtered
 * list view rather than a page per bill.
 *
 * Money is stored in **integer minor units** throughout.
 *
 * The header totals (`subtotal`, `shippingTotal`, `taxTotal`, `total`) are
 * deliberately NOT computed, unlike their `purchase_order` namesakes: they are
 * transcribed from the vendor's paper. Recomputing them from the lines would
 * silently correct the vendor's own arithmetic, which is precisely the
 * discrepancy the match exists to surface.
 */
export const VENDOR_BILL_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique vendor bill identifier',
  },

  // The VENDOR's invoice number — their document, not ours. Human-entered and
  // required: it is how a bill is recognised on a statement, in a payment run
  // and on the phone, and a bill that arrives without one is not a bill yet.
  // No sequence issues it; see `internalNumber` for the number we own.
  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Vendor Invoice No.',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_number',
    systemSortOrder: 'a1',
    nullable: false,
    isIdentifier: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Enter the vendor invoice number',
    description:
      "The vendor's own invoice number, keyed from their document — required, and NOT " +
      'sequence-issued. Two vendors may legitimately use the same string.',
  },

  internalNumber: {
    id: toFieldId('internalNumber'),
    key: 'internalNumber',
    label: 'Internal No.',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_internal_number',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // RecordSequence-issued — the hook is the ONLY writer
      updatable: false,
      configurable: false,
    },
    description:
      'Our own reference for this bill — RecordSequence scope `vendor_bill`, prefix `BILL`. ' +
      'Issued by the numbering hook, which is the only writer.',
  },

  vendor: {
    id: toFieldId('vendor'),
    key: 'vendor',
    label: 'Vendor',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_vendor',
    systemSortOrder: 'a3',
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'company:vendorBills' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'company',
      relationshipType: 'belongs_to',
      inverseName: 'Vendor Bills',
      inverseSystemAttribute: 'company_vendor_bills',
    },
    description: 'The company that billed us — required, the party the A/P balance is owed to',
  },

  // NULLABLE on purpose. A bill with no purchase order is legal and common: a
  // freight invoice, a one-off, a utility. Requiring a PO here would force
  // someone to raise a fake one, which is worse than an unmatched bill.
  purchaseOrder: {
    id: toFieldId('purchaseOrder'),
    key: 'purchaseOrder',
    label: 'Purchase Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_purchase_order',
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
      inverseResourceFieldId: 'purchase_order:bills' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'purchase_order',
      relationshipType: 'belongs_to',
      inverseName: 'Bills',
      inverseSystemAttribute: 'purchase_order_bills',
    },
    description:
      'Purchase order this bill is against — optional. A freight invoice or a one-off has no PO ' +
      'and is billed straight to an expense code.',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'vendor_bill_status',
    systemSortOrder: 'a5',
    nullable: true,
    options: { options: VendorBillStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    description: 'Where the bill sits between arriving and being paid',
    defaultValue: VendorBillStatus.DRAFT,
  },

  billedAt: {
    id: toFieldId('billedAt'),
    key: 'billedAt',
    label: 'Bill Date',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'vendor_bill_billed_at',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select bill date',
    description:
      "The vendor's invoice date — the ACCOUNTING date. `createdAt` records when the paperwork " +
      'was keyed, which is routinely a different period.',
  },

  dueAt: {
    id: toFieldId('dueAt'),
    key: 'dueAt',
    label: 'Due',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'vendor_bill_due_at',
    systemSortOrder: 'a7',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select due date',
    description: 'When payment is due — the payment run reads this',
  },

  currency: {
    id: toFieldId('currency'),
    key: 'currency',
    label: 'Currency',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_currency',
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'USD',
    description: 'ISO 4217 code the money fields are denominated in',
    showInPanel: false,
  },

  subtotal: {
    id: toFieldId('subtotal'),
    key: 'subtotal',
    label: 'Subtotal',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_bill_subtotal',
    systemSortOrder: 'a9',
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
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Goods subtotal as the vendor stated it, integer minor units',
  },

  shippingTotal: {
    id: toFieldId('shippingTotal'),
    key: 'shippingTotal',
    label: 'Shipping',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_bill_shipping_total',
    systemSortOrder: 'aA',
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
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Freight as the vendor stated it, integer minor units',
  },

  taxTotal: {
    id: toFieldId('taxTotal'),
    key: 'taxTotal',
    label: 'Tax',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_bill_tax_total',
    systemSortOrder: 'aB',
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
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Tax as the vendor stated it, integer minor units',
  },

  total: {
    id: toFieldId('total'),
    key: 'total',
    label: 'Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_bill_total',
    systemSortOrder: 'aC',
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
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'What the vendor is asking for, integer minor units — keyed from their document, not ' +
      're-derived from the lines',
  },

  // Written by the three-way match hook, never by hand. A variance someone can
  // type is not evidence of anything.
  matchVariance: {
    id: toFieldId('matchVariance'),
    key: 'matchVariance',
    label: 'Match Variance',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_bill_match_variance',
    systemSortOrder: 'aD',
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
      creatable: false, // the three-way match hook is the only writer
      updatable: false,
      configurable: false,
    },
    description:
      'Total billed less total expected, integer minor units — computed by the three-way match. ' +
      'Zero means the bill agrees with the PO and the receipts.',
  },

  matchNotes: {
    id: toFieldId('matchNotes'),
    key: 'matchNotes',
    label: 'Match Notes',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_match_notes',
    systemSortOrder: 'aE',
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false, // the three-way match hook is the only writer
      updatable: false,
      configurable: false,
    },
    description:
      'Why this bill is an exception, in words — computed by the three-way match so the queue ' +
      'says what is wrong rather than only that something is',
  },

  paidAt: {
    id: toFieldId('paidAt'),
    key: 'paidAt',
    label: 'Paid',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'vendor_bill_paid_at',
    systemSortOrder: 'aF',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select payment date',
    description: 'When the bill was paid — null means unpaid',
  },

  amountPaid: {
    id: toFieldId('amountPaid'),
    key: 'amountPaid',
    label: 'Amount Paid',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_bill_amount_paid',
    systemSortOrder: 'aG',
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
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'How much of this bill has been settled, integer minor units — written by a human or by ' +
      'the provider poll while `vendor_payment` is inert',
  },

  // Written by `purchasing/vendor-bill-balance.ts`, never by hand — a
  // hand-maintained copy of a subtraction diverges silently. Stored, like every
  // money field here, in integer minor units.
  //
  // 🛑 `computed` was FALSE while the field also had no writer, which is how the
  // two halves of one defect hid each other: nothing derived the value, and
  // nothing declared that anything should. It is `true` now for the same reason
  // `purchase_order_line_quantity_billed` is — it is what `fieldLockReason`
  // reads to say "computed" rather than merely "system", and what excludes the
  // field from connector-writable surfaces.
  //
  // ⚠️ `ensureCustomFields` is INSERT-only, so flipping it here reaches NEW orgs
  // only — an org that already ran 108 keeps whatever its `CustomField` row was
  // created with. No migration carries it, deliberately: nothing is live yet, so
  // the dev database was corrected in place instead.
  balance: {
    id: toFieldId('balance'),
    key: 'balance',
    label: 'Balance',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_bill_balance',
    systemSortOrder: 'aH',
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
      creatable: false, // computed from total and amountPaid
      updatable: false,
      computed: true,
      configurable: false,
    },
    description: 'What is still owed on this bill — the total minus what has been paid',
  },

  paymentMethod: {
    id: toFieldId('paymentMethod'),
    key: 'paymentMethod',
    label: 'Payment Method',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_payment_method',
    systemSortOrder: 'aI',
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Check, ACH, card',
    description: 'How it was paid — free text; a select is premature until the values settle',
  },

  paymentReference: {
    id: toFieldId('paymentReference'),
    key: 'paymentReference',
    label: 'Payment Reference',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_payment_reference',
    systemSortOrder: 'aJ',
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Check no. / ACH trace / bank line id',
    description: 'Check number, ACH trace or bank line id — what a query to the bank quotes',
  },

  paidSource: {
    id: toFieldId('paidSource'),
    key: 'paidSource',
    label: 'Paid Source',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'vendor_bill_paid_source',
    systemSortOrder: 'aK',
    nullable: true,
    options: { options: VendorBillPaidSource.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select paid source',
    description:
      'What evidence marked this bill paid. Not decoration: an auto-mark that cannot be told ' +
      'apart from a confirmed payment is how a genuinely unpaid bill goes quiet until the ' +
      'vendor calls. `rule` is a PRESUMPTION, not evidence — those bills stay in a presumed-paid, ' +
      'unconfirmed filter until a provider read or a bank line confirms them.',
  },

  // The vendor's own paper — the bill itself, as a single FILE value
  // (plans/purchasing/08-documents-on-records.md P18). `image` is in the allowed
  // list deliberately: what arrives is very often a phone photo of paper. This is
  // the phase-2 parse target, which is why it is a single slot and not the first
  // element of `attachments` — a caption is a label, not a contract.
  document: {
    id: toFieldId('document'),
    key: 'document',
    label: 'Bill document',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'vendor_bill_document',
    systemSortOrder: 'aL',
    showInPanel: false,
    nullable: true,
    options: {
      file: { allowMultiple: false, maxFiles: 1, allowedFileTypes: ['document', 'image'] },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      "The vendor's invoice as received (PDF or photo) — surfaced through the documents card, " +
      'never as an editable text box',
  },

  // Everything that is not the bill: packing slip, freight invoice, correspondence,
  // a photo of the damage. Multi, and hidden from the Details panel for the same
  // reason `document` is — the documents card renders both.
  attachments: {
    id: toFieldId('attachments'),
    key: 'attachments',
    label: 'Attachments',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'vendor_bill_attachments',
    systemSortOrder: 'aL1',
    showInPanel: false,
    nullable: true,
    options: {
      file: { allowMultiple: true, maxFiles: 20, allowedFileTypes: ['document', 'image'] },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Supporting documents for this bill — packing slips, freight invoices, photos',
  },

  // Reverse relationship: lines (from vendor_bill_line.vendorBill). Until the
  // `vendor_bill_line` side is materialised, `linkNewRelationships` leaves this
  // unlinked and links it when the counterpart appears.
  lines: {
    id: toFieldId('lines'),
    key: 'lines',
    label: 'Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_lines',
    systemSortOrder: 'aM',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_bill_line:vendorBill' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Lines on this bill',
  },

  // Reverse relationship: paymentAllocations (from
  // vendor_payment_allocation.vendorBill). `vendor_payment_allocation` ships
  // seeded, hidden and INERT (§5.4) — nothing writes it yet, so this edge reads
  // empty until the payment write path is built.
  paymentAllocations: {
    id: toFieldId('paymentAllocations'),
    key: 'paymentAllocations',
    label: 'Payment Allocations',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_payment_allocations',
    systemSortOrder: 'aN',
    showInPanel: false,
    showInTable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_payment_allocation:vendorBill' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description:
      'Shares of vendor payments applied to this bill — one row per payment that covers part of ' +
      'it',
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
    description: 'Automatically set when the vendor bill is created',
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
    description: 'Automatically updated when the vendor bill is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
