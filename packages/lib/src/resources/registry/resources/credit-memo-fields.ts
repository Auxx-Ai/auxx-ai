// packages/lib/src/resources/registry/resources/credit-memo-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Credit memo lifecycle (plans/accounting/tasks/10-credit-memos.md §2.4).
 *
 * ```
 * draft --issue--> issued --(balance reaches 0)--> settled
 *   |                 |
 *   +--discard        +--void (only while nothing is applied or refunded)
 * ```
 *
 * `settled` is written only by the settlement writer (`money/credit-memos/settle.ts`),
 * never by hand. An issued memo is corrected by void and re-issue, never by edit,
 * the same discipline as `journal_entry`.
 */
export const CREDIT_MEMO_STATUS_OPTIONS = [
  { label: 'Draft', value: 'draft', color: 'gray' },
  { label: 'Issued', value: 'issued', color: 'blue' },
  { label: 'Settled', value: 'settled', color: 'green' },
  { label: 'Void', value: 'void', color: 'gray' },
] as const

/**
 * Who started the credit (§1). `native` is a person, from an invoice or from
 * scratch, settled later by apply, hold or refund. `channel` is the connector,
 * from `refunds[]` on an order, already refunded at the channel. Set once on
 * create and never editable: the two sources link, settle and review differently.
 */
export const CREDIT_MEMO_SOURCE_OPTIONS = [
  { label: 'Native', value: 'native', color: 'blue' },
  { label: 'Channel', value: 'channel', color: 'purple' },
] as const

/**
 * Why the credit was given (§2.1). The channel path sets `cancellation` when
 * every line is `cancelled`, else `allowance`; a reviewer can change it while
 * the memo is `draft`.
 */
export const CREDIT_MEMO_REASON_OPTIONS = [
  { label: 'Return', value: 'return', color: 'amber' },
  { label: 'Allowance', value: 'allowance', color: 'blue' },
  { label: 'Billing error', value: 'billing_error', color: 'red' },
  { label: 'Cancellation', value: 'cancellation', color: 'gray' },
  { label: 'Other', value: 'other', color: 'gray' },
] as const

/**
 * Field definitions for the Credit Memo resource
 * (plans/accounting/tasks/10-credit-memos.md §2.1, §10.2).
 *
 * ## One document for "you owe us less", whoever started it
 *
 * A credit memo is the mirror of an invoice. An invoice says "you owe us 500";
 * a credit memo says "you owe us 120 less". Issuing it moves the debt and
 * nothing else. What happens to the 120 afterwards is a second step: apply it
 * to an open invoice, hold it as credit on the contact, or refund it.
 *
 * A Shopify refund is the same fact arriving from the other direction: a credit
 * memo created and refunded in the same instant. So there is ONE entity, and
 * `source` says who started it (`native` or `channel`). "Refund" was the wrong
 * name the moment a concession is issued on an unpaid invoice, because nothing
 * is paid back.
 *
 * ## Native entity, not a JSON dump
 *
 * On the channel path the memo is projected out of the order payload the
 * connector already fetches, as a `refunds[]` fan-out, and every money value is
 * scaled through `decimalToMinorUnits` on the way in. Letting the posting
 * builder read `raw.refunds` instead would put unscaled provider strings at the
 * ledger, which is where the 100x bug of money plan 37 §2.4 lived. Shopify maps
 * into this contract; the accounting code never reads Shopify fields directly.
 *
 * ## Channel total equals channel refund by construction
 *
 * Shopify sends no total on a refund, and most observed refunds carried no
 * line items at all. The connector therefore emits the lines it has plus ONE
 * remainder line with no line item ("Refund adjustment") so that
 * `total == amount_refunded` and the memo is `settled` the moment it is issued.
 * A native concession is the same thing: a line with no line item. One rule.
 *
 * Money is integer minor units.
 */
export const CREDIT_MEMO_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique credit memo identifier',
  },

  // `CM-` series through `keepOrAllocateRecordNumber`. The connector supplies
  // no number of its own, so the channel path allocates ours too.
  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'credit_memo_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // hook-generated, prefix CM - the hook is the ONLY writer
      updatable: false,
      configurable: false,
    },
    description: 'Auto-generated credit memo number',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'credit_memo_status',
    systemSortOrder: 'a2',
    nullable: false,
    options: { options: [...CREDIT_MEMO_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'draft',
    description: 'Where the memo sits between drafting and settling',
  },

  source: {
    id: toFieldId('source'),
    key: 'source',
    label: 'Source',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'credit_memo_source',
    systemSortOrder: 'a3',
    nullable: false,
    options: { options: [...CREDIT_MEMO_SOURCE_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false, // set once on create, never editable
      configurable: false,
    },
    placeholder: 'Select source',
    defaultValue: 'native',
    description:
      'Who started the credit: a person (native) or the sales channel connector (channel). ' +
      'Set once on create and never editable',
  },

  reason: {
    id: toFieldId('reason'),
    key: 'reason',
    label: 'Reason',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'credit_memo_reason',
    systemSortOrder: 'a4',
    nullable: true,
    options: { options: [...CREDIT_MEMO_REASON_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select reason',
    description:
      'Why the credit was given. The channel path sets cancellation when every line is ' +
      'cancelled, else allowance; a reviewer can change it while the memo is a draft',
  },

  /**
   * When the credit takes effect.
   *
   * THE accounting date. `build-credit-memo-entry.ts` dates the ledger entry
   * from this field and never from ingest time, and the period lock applies to
   * it. Native: the day the memo is issued, set by `issueCreditMemo`. Channel:
   * the refund's own `created_at` at Shopify. The Shopify connector is
   * manual-only, so the gap between a refund happening and auxx seeing it is
   * unbounded and can cross a period close: taking the ingest timestamp would
   * post a July refund into September.
   *
   * Nullable only while `draft`. `createdAt` is when the row was written and is
   * never the accounting date.
   */
  issuedAt: {
    id: toFieldId('issuedAt'),
    key: 'issuedAt',
    label: 'Issued',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'credit_memo_issued_at',
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
      'this, never from when the row was written. Native: the day it is issued. Channel: the ' +
      "refund's created_at at the provider",
  },

  note: {
    id: toFieldId('note'),
    key: 'note',
    label: 'Note',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'credit_memo_note',
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
    description:
      'Free text printed on the document. On the channel path it is the provider note, the ' +
      'only free text the refund payload carries',
  },

  contact: {
    id: toFieldId('contact'),
    key: 'contact',
    label: 'Contact',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'credit_memo_contact',
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
      inverseResourceFieldId: 'contact:creditMemos' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'contact',
      relationshipType: 'belongs_to',
      inverseName: 'Credit Memos',
      inverseSystemAttribute: 'contact_credit_memos',
    },
    description:
      'The customer being credited - required. Native: from the invoice or picked. Channel: ' +
      "the connector sets it from the order's contact",
  },

  invoice: {
    id: toFieldId('invoice'),
    key: 'invoice',
    label: 'Invoice',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'credit_memo_invoice',
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
      inverseResourceFieldId: 'invoice:creditMemos' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'invoice',
      relationshipType: 'belongs_to',
      inverseName: 'Credit Memos',
      inverseSystemAttribute: 'invoice_credit_memos',
    },
    description:
      'The invoice this memo was raised against - optional. A concession from scratch and a ' +
      'channel refund have none',
  },

  /**
   * The order this memo was taken against. The owning side of
   * `order_credit_memos`, which stays `cascade` and is vetoed by the delete
   * guard: deleting an order with an issued memo is refused naming the memo.
   */
  order: {
    id: toFieldId('order'),
    key: 'order',
    label: 'Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'credit_memo_order',
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
      inverseResourceFieldId: 'order:creditMemos' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'order',
      relationshipType: 'belongs_to',
      inverseName: 'Credit Memos',
      inverseSystemAttribute: 'order_credit_memos',
    },
    description:
      'The order this memo was taken against - optional, set by the channel path. Also the ' +
      "discriminator the entry builder needs: the order's first fulfillment date against " +
      'the issue date decides whether any revenue was ever posted to reverse',
  },

  subtotal: {
    id: toFieldId('subtotal'),
    key: 'subtotal',
    label: 'Subtotal',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'credit_memo_subtotal',
    systemSortOrder: 'aA',
    showInPanel: false, // shown in the lines card
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
      creatable: false, // totals hook (§2.5) is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Sum of line subtotals, integer minor units - written by the totals hook',
  },

  // Transcribed from the lines, never prorated from a rate (47 §6.2).
  taxTotal: {
    id: toFieldId('taxTotal'),
    key: 'taxTotal',
    label: 'Tax Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'credit_memo_tax_total',
    systemSortOrder: 'aB',
    showInPanel: false, // shown in the lines card
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
      creatable: false, // totals hook (§2.5) is the only writer
      updatable: false,
      configurable: false,
    },
    description:
      'Sum of line tax totals, integer minor units - written by the totals hook. Transcribed ' +
      'from the lines, never recomputed from a rate',
  },

  total: {
    id: toFieldId('total'),
    key: 'total',
    label: 'Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'credit_memo_total',
    systemSortOrder: 'aC',
    showInPanel: false, // shown in the lines card
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
      creatable: false, // totals hook (§2.5) is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Subtotal plus tax, integer minor units - written by the totals hook',
  },

  amountApplied: {
    id: toFieldId('amountApplied'),
    key: 'amountApplied',
    label: 'Amount Applied',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'credit_memo_amount_applied',
    systemSortOrder: 'aD',
    showInPanel: false, // shown on the settlement card
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
      creatable: false, // settle (§5.3) is the only writer
      updatable: false,
      configurable: false,
    },
    description:
      'Sum of the applications against invoices, integer minor units - derived by the ' +
      'settlement writer, never settable',
  },

  /**
   * The money that actually went back, in integer minor units.
   *
   * DERIVED, and named for it. Native: the settlement writer sums the succeeded
   * refund transactions carrying this memo. Channel: the connector transcribes
   * the sum of `transactions[] where kind == 'refund' and status == 'success'`,
   * because a Shopify refund object carries NO total at all. That is why this
   * is the one derived amount with `creatable: true`: the connector has to
   * write it on the insert, and rewrite it on a content-hash re-ingest.
   *
   * Do not rename this to `credit_memo_total`. The name carries the distinction
   * between what was credited and what was paid back.
   *
   * Null is not zero. Null means no refund legs exist to sum, which is a
   * knowable gap rather than a refund of nothing; zero means legs exist and
   * none of them succeeded.
   */
  amountRefunded: {
    id: toFieldId('amountRefunded'),
    key: 'amountRefunded',
    label: 'Amount Refunded',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'credit_memo_amount_refunded',
    systemSortOrder: 'aE',
    showInPanel: false, // shown on the settlement card
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
      creatable: true, // the channel connector transcribes it on insert
      updatable: true, // and rewrites it on a content-hash re-ingest
      configurable: false,
    },
    description:
      'Integer minor units. Native: the sum of succeeded refund transactions carrying this ' +
      'memo, written by the settlement writer. Channel: transcribed by the connector as the ' +
      'sum of the successful refund transactions, because the provider supplies no total. ' +
      'Null means no refund legs exist to sum, which is not the same as a refund of zero',
  },

  balance: {
    id: toFieldId('balance'),
    key: 'balance',
    label: 'Balance',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'credit_memo_balance',
    systemSortOrder: 'aF',
    showInPanel: false, // shown on the settlement card
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
      creatable: false, // settle (§5.3) is the only writer
      updatable: false,
      configurable: false,
    },
    description:
      'Total minus applied minus refunded, integer minor units - derived by the settlement ' +
      'writer. Zero is what flips the memo to settled',
  },

  /**
   * The lines: one record per credited line, or a free-text concession line
   * with no line item. Empty is the ordinary case on a channel draft before
   * the remainder line is added, and lines are frozen once the memo is issued.
   */
  lines: {
    id: toFieldId('lines'),
    key: 'lines',
    label: 'Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'credit_memo_lines',
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
      inverseResourceFieldId: 'credit_memo_line:creditMemo' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description:
      'The lines on this memo - one per credited line item, plus any concession or remainder ' +
      'line with no line item',
  },

  // Reverse relationship: applications (from credit_memo_application.creditMemo).
  // One row per "this much of this memo went against this invoice".
  applications: {
    id: toFieldId('applications'),
    key: 'applications',
    label: 'Applications',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'credit_memo_applications',
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
      inverseResourceFieldId: 'credit_memo_application:creditMemo' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description: 'Shares of this memo applied to invoices - one row per invoice it reduced',
  },

  // The last-rendered credit memo PDF, as a single FILE value - the documents
  // registry's `pointerAttr`. Written ONLY by `ensureDocumentPdf`;
  // `updatable: false` is what keeps every human door shut, exactly as on
  // `invoice_pdf_asset`.
  //
  // Never make this user-writable. `ensureDocumentPdf` reads the pointer, loads
  // that MediaAsset and appends a new VERSION to it whenever the content hash
  // disagrees. A file a person uploaded has no `contentHash` at all, so the
  // comparison always fails and the next send would silently republish their
  // file as our PDF.
  pdfAsset: {
    id: toFieldId('pdfAsset'),
    key: 'pdfAsset',
    label: 'Credit Memo PDF',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'credit_memo_pdf_asset',
    systemSortOrder: 'aI',
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
    description: 'The generated PDF for this credit memo',
  },

  // A supporting document for the credit, as a single FILE value - the same
  // slot `vendor_bill_document` is: an RMA, the customer's claim, a photo of
  // the damage. Surfaced through the documents card, never as a text box.
  document: {
    id: toFieldId('document'),
    key: 'document',
    label: 'Document',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'credit_memo_document',
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
    description:
      'A supporting document for the credit (PDF or photo) - surfaced through the documents ' +
      'card',
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
    description:
      'Automatically set when the credit memo is created in auxx. Never the accounting ' +
      'date - see issuedAt',
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
    description: 'Automatically updated when the credit memo is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
