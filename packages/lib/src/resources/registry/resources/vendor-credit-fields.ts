// packages/lib/src/resources/registry/resources/vendor-credit-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { defineResourceFields } from '../system-attributes'

/**
 * Vendor credit lifecycle — the mirror of {@link CREDIT_MEMO_STATUS_OPTIONS}.
 *
 * ```
 * draft --issue--> issued --(balance reaches 0)--> settled
 *   |                 |
 *   +--discard        +--void (only while nothing is applied or refunded)
 * ```
 *
 * `settled` is written only by `purchasing/vendor-credit/settle.ts`.
 */
export const VENDOR_CREDIT_STATUS_OPTIONS = [
  { label: 'Draft', value: 'draft', color: 'gray' },
  { label: 'Issued', value: 'issued', color: 'blue' },
  { label: 'Settled', value: 'settled', color: 'green' },
  { label: 'Void', value: 'void', color: 'gray' },
] as const

/** One of {@link VENDOR_CREDIT_STATUS_OPTIONS}. */
export type VendorCreditStatus = (typeof VENDOR_CREDIT_STATUS_OPTIONS)[number]['value']

/** Why the supplier raised the credit. */
export const VENDOR_CREDIT_REASON_OPTIONS = [
  { label: 'Return to vendor', value: 'return', color: 'amber' },
  { label: 'Short shipment', value: 'short_shipment', color: 'orange' },
  { label: 'Allowance', value: 'allowance', color: 'blue' },
  { label: 'Billing error', value: 'billing_error', color: 'red' },
  { label: 'Cancellation', value: 'cancellation', color: 'gray' },
  { label: 'Other', value: 'other', color: 'gray' },
] as const

/**
 * Field definitions for the Vendor Credit resource — the purchase-side mirror
 * of `credit_memo` (task 71 §5 U7, D10).
 *
 * A supplier's credit note is a DOCUMENT, not an edit to a bill's total. It has
 * lines, a status, attachments and a PDF, exactly as a credit memo does, and
 * issuing it posts `Dr accounts_payable / Cr <each line's account>` — the
 * expense bill's entry with the sides flipped.
 *
 * Its lines carry a `gl_account` id like a `vendor_bill_line`, not the sell-side
 * vocabulary of a `credit_memo_line`: what is being credited is an amount we
 * were charged, coded to the account it was charged to. A credit raised against
 * a PO-backed bill is prefilled with the org's resolved `grni` account, so the
 * short-shipment entry `Dr A/P / Cr GRNI` is the same entry with that account on
 * the line.
 *
 * 🛑 A vendor credit does not touch inventory quantities. A physical return to
 * the supplier is a `stock_movement` on its own document; this is the money side
 * only, and a person raises both.
 *
 * Money is integer minor units.
 */
export const VENDOR_CREDIT_FIELDS = defineResourceFields({
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
    description: 'Unique vendor credit identifier',
  },

  // OURS — `VC-` through `keepOrAllocateRecordNumber`. The issue entry's
  // `periodKey` is this and never the supplier's own reference: two vendors may
  // legitimately print the same credit-note number, and two entries sharing a
  // period key means the second one silently converges to `already_posted`.
  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_credit_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // hook-generated, prefix VC - the hook is the ONLY writer
      updatable: false,
      configurable: false,
    },
    description: 'Auto-generated vendor credit number',
  },

  vendorReference: {
    id: toFieldId('vendorReference'),
    key: 'vendorReference',
    label: 'Vendor Credit No.',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_credit_vendor_reference',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Their credit note number',
    description:
      "The supplier's own reference for this credit note, as printed on their paper. How it " +
      'is recognised on a statement; never the key the ledger entry uses',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'vendor_credit_status',
    systemSortOrder: 'a3',
    nullable: false,
    options: { options: [...VENDOR_CREDIT_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'draft',
    description: 'Where the credit sits between drafting and settling',
  },

  reason: {
    id: toFieldId('reason'),
    key: 'reason',
    label: 'Reason',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'vendor_credit_reason',
    systemSortOrder: 'a4',
    nullable: true,
    options: { options: [...VENDOR_CREDIT_REASON_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select reason',
    description: 'Why the supplier raised the credit',
  },

  /**
   * When the credit takes effect — THE accounting date. The issue entry is
   * dated from this and never from when the row was written, and the period
   * lock applies to it.
   */
  issuedAt: {
    id: toFieldId('issuedAt'),
    key: 'issuedAt',
    label: 'Issued',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'vendor_credit_issued_at',
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
    description:
      'When the credit takes effect. THE accounting date - the ledger entry is dated from ' +
      'this, never from when the row was written',
  },

  note: {
    id: toFieldId('note'),
    key: 'note',
    label: 'Note',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_credit_note',
    systemSortOrder: 'a6',
    showInTable: false,
    nullable: true,
    options: { multiline: true, rows: 2 },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter a note',
    description: 'Free text printed on the document',
  },

  vendor: {
    id: toFieldId('vendor'),
    key: 'vendor',
    label: 'Vendor',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_credit_vendor',
    systemSortOrder: 'a7',
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
      inverseResourceFieldId: 'company:vendorCredits' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'company',
      relationshipType: 'belongs_to',
      inverseName: 'Vendor Credits',
      inverseSystemAttribute: 'company_vendor_credits',
    },
    description:
      'The supplier giving the credit - required. The A/P counterparty on the issue entry',
  },

  bill: {
    id: toFieldId('bill'),
    key: 'bill',
    label: 'Vendor Bill',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_credit_bill',
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_bill:vendorCredits' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_bill',
      relationshipType: 'belongs_to',
      inverseName: 'Vendor Credits',
      inverseSystemAttribute: 'vendor_bill_vendor_credits',
    },
    description:
      'The bill this credit was raised against - optional. Also what decides whether the ' +
      "lines are prefilled with the org's GRNI account: a credit against a PO-backed bill is",
  },

  purchaseOrder: {
    id: toFieldId('purchaseOrder'),
    key: 'purchaseOrder',
    label: 'Purchase Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_credit_purchase_order',
    systemSortOrder: 'a9',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'purchase_order:vendorCredits' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'purchase_order',
      relationshipType: 'belongs_to',
      inverseName: 'Vendor Credits',
      inverseSystemAttribute: 'purchase_order_vendor_credits',
    },
    description: 'The order this credit relates to - optional',
  },

  subtotal: {
    id: toFieldId('subtotal'),
    key: 'subtotal',
    label: 'Subtotal',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_credit_subtotal',
    systemSortOrder: 'aA',
    showInPanel: false, // shown in the lines card
    nullable: true,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // the totals hook is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Sum of line totals, integer minor units - written by the totals hook',
  },

  /**
   * Tax the supplier stated on the header.
   *
   * ⚠️ Folded into `total` on top of the subtotal, and the issue entry ties to
   * `total`. A credit whose header carries tax and whose lines do not account
   * for it is refused naming the difference, exactly as an expense bill is: tax
   * and freight carry no account of their own, so they get their own coded line.
   */
  taxTotal: {
    id: toFieldId('taxTotal'),
    key: 'taxTotal',
    label: 'Tax',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_credit_tax_total',
    systemSortOrder: 'aB',
    showInPanel: false,
    nullable: true,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Tax as the supplier stated it on the credit note, integer minor units',
  },

  total: {
    id: toFieldId('total'),
    key: 'total',
    label: 'Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_credit_total',
    systemSortOrder: 'aC',
    showInPanel: false,
    nullable: true,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // the totals hook is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Subtotal plus stated tax, integer minor units - written by the totals hook',
  },

  amountApplied: {
    id: toFieldId('amountApplied'),
    key: 'amountApplied',
    label: 'Amount Applied',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_credit_amount_applied',
    systemSortOrder: 'aD',
    showInPanel: false,
    nullable: true,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // settleVendorCredit is the only writer
      updatable: false,
      configurable: false,
    },
    description:
      'Sum of the applications against bills, integer minor units - derived by the settlement ' +
      'writer, never settable',
  },

  amountRefunded: {
    id: toFieldId('amountRefunded'),
    key: 'amountRefunded',
    label: 'Amount Refunded',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_credit_amount_refunded',
    systemSortOrder: 'aE',
    showInPanel: false,
    nullable: true,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // settleVendorCredit is the only writer
      updatable: false,
      configurable: false,
    },
    description:
      'What the supplier actually paid back, integer minor units - the sum of the ' +
      '`vendor_refund` movements settling this credit, derived by the settlement writer',
  },

  balance: {
    id: toFieldId('balance'),
    key: 'balance',
    label: 'Balance',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_credit_balance',
    systemSortOrder: 'aF',
    showInPanel: false,
    nullable: true,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // settleVendorCredit is the only writer
      updatable: false,
      configurable: false,
    },
    description:
      'Total minus applied minus refunded, integer minor units. Zero is what flips the credit ' +
      'to settled',
  },

  lines: {
    id: toFieldId('lines'),
    key: 'lines',
    label: 'Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_credit_lines',
    systemSortOrder: 'aG',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_credit_line:vendorCredit' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description: 'The lines on this credit - one per credited amount, each coded to an account',
  },

  applications: {
    id: toFieldId('applications'),
    key: 'applications',
    label: 'Applications',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_credit_applications',
    systemSortOrder: 'aH',
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_credit_application:vendorCredit' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description: 'Shares of this credit applied to bills - one row per bill it reduced',
  },

  // Written ONLY by `ensureDocumentPdf`; `updatable: false` keeps every human
  // door shut, exactly as on `credit_memo_pdf_asset`.
  pdfAsset: {
    id: toFieldId('pdfAsset'),
    key: 'pdfAsset',
    label: 'Vendor Credit PDF',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'vendor_credit_pdf_asset',
    systemSortOrder: 'aI',
    showInPanel: false,
    nullable: true,
    options: { file: { allowMultiple: false, maxFiles: 1, allowedFileTypes: ['document'] } },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
      hidden: true,
    },
    description: 'The generated PDF for this vendor credit',
  },

  attachments: {
    id: toFieldId('attachments'),
    key: 'attachments',
    label: 'Attachments',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'vendor_credit_attachments',
    systemSortOrder: 'aI1',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
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
      hidden: true,
    },
    description: 'Supporting documents for this vendor credit',
  },

  // The supplier's own paper — their credit note as received.
  document: {
    id: toFieldId('document'),
    key: 'document',
    label: 'Document',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'vendor_credit_document',
    systemSortOrder: 'aJ',
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
    description: "The supplier's credit note as received - surfaced through the documents card",
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
    description: 'Automatically set when the vendor credit is created - never the accounting date',
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
    description: 'Automatically updated when the vendor credit is modified',
  },

  createdBy: CREATED_BY_FIELD,
})
