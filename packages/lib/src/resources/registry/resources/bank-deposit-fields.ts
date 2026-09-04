// packages/lib/src/resources/registry/resources/bank-deposit-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * `pending` until the bank shows the deposit, `cleared` once it has been matched
 * to a bank line.
 *
 * Two values and no `void`: a deposit is corrected by reversing its posting and
 * regrouping the payments, never by editing the row
 * (plans/accounting/tasks/06-deposit-grouping.md §3).
 */
export const BANK_DEPOSIT_STATUS_OPTIONS = [
  { label: 'Pending', value: 'pending', color: 'amber' },
  { label: 'Cleared', value: 'cleared', color: 'green' },
] as const

/**
 * Field definitions for the Bank Deposit resource
 * (plans/accounting/tasks/06-deposit-grouping.md §2.2).
 *
 * ## Why this entity exists at all
 *
 * Five customer cheques banked together arrive at the bank as **one line**. Five
 * separate cash postings can never match it, so without a deposit object the
 * bank feed's review queue can only ever *code* receipts and never *match*
 * them. A deposit is the grouping that turns N receipts into the one cash line
 * the statement actually shows.
 *
 * ⚠️ **A bank deposit is NOT a customer deposit.** `money/payments/deposit.ts`
 * is about money taken before delivery - a LIABILITY, account
 * `2350 Customer Deposits`. Same English word, two unrelated concepts. Say
 * "bank deposit" in full, every time.
 *
 * ## The three properties the rest of this file follows from
 *
 * **The posting is `Dr cash Cr undeposited_funds`, one line each**, and
 * `bank_deposit` is the ONLY declared writer of the `cash` role
 * (`postings/regime.ts`'s `SINGLE_WRITER_ROLES_BY_POSTING_TYPE`). A second
 * writer would overstate cash by the deposit with nothing to flag it.
 *
 * **A matched deposit is immutable.** Once `bankTransactionId` is set or
 * `status` reads `cleared`, `updateBankDeposit` refuses - correct by reversing,
 * the same rule the movement ledger keeps. The fields stay `updatable: true`
 * because the refusal is a business rule in `money/bank-deposits/`, not a
 * capability: the clearing write itself has to go through them.
 *
 * **A payment can be in exactly one deposit.** That is enforced by
 * `createBankDeposit` reading {@link BANK_DEPOSIT_FIELDS.payments}' inverse
 * (`payment_bank_deposit`) before it writes, not by a database constraint -
 * `FieldValue` cannot express one.
 *
 * ⚠️ **`bankTransactionId`, `clearedAt` and `reconciledAt` copy
 * the vendor payment side's three columns by name and by meaning**, so the feed's
 * matcher has one shape to look for rather than two. `bankTransactionId` is
 * bare TEXT here for the same reason it is there: the `bank_transaction` def
 * does not exist yet (slot 2I), and a RELATIONSHIP cannot point at a def that
 * is not in the org. A later migration converts BOTH sides together.
 *
 * `bankAccount` is a GL account **CODE** as TEXT, the
 * `vendor_bill_line_gl_account` precedent, and becomes a RELATIONSHIP to
 * `bank_account` when 2I lands.
 *
 * Money is integer minor units ({@link BANK_DEPOSIT_FIELDS.totalMinor}).
 */
export const BANK_DEPOSIT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique bank deposit identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_deposit_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      // RecordSequence-issued (`DEP-0001`), the `build` / `order` precedent -
      // the system hook is the ONLY writer. It is also what the posting's
      // document number keys on (`postings/doc-number.ts`'s `DocNumberInput`),
      // because two deposits can be banked on one day and a cuid is over the
      // 21-character cap.
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically generated deposit number',
  },

  depositDate: {
    id: toFieldId('depositDate'),
    key: 'depositDate',
    label: 'Deposit Date',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'bank_deposit_date',
    systemSortOrder: 'a2',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select deposit date',
    description:
      'The date the deposit hits the bank. THE accounting date - the posting is dated from ' +
      'this, not from when the payments were received',
  },

  bankAccount: {
    id: toFieldId('bankAccount'),
    key: 'bankAccount',
    label: 'Bank Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_deposit_bank_account',
    systemSortOrder: 'a3',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '1000',
    description:
      'The GL account CODE the money lands in, from the org own chart. TEXT rather than a ' +
      'RELATIONSHIP because the bank_account def does not exist yet (HANDOFF slot 2I); a ' +
      'later migration converts it, alongside the vendor payment side twin',
  },

  reference: {
    id: toFieldId('reference'),
    key: 'reference',
    label: 'Reference',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_deposit_reference',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Deposit slip number',
    description: 'The deposit slip number the bank issued, or whatever the teller wrote',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_deposit_status',
    systemSortOrder: 'a5',
    nullable: false,
    options: { options: [...BANK_DEPOSIT_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'pending',
    description: 'pending until the bank shows it, cleared once it is matched to a bank line',
  },

  totalMinor: {
    id: toFieldId('totalMinor'),
    key: 'totalMinor',
    label: 'Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'bank_deposit_total',
    systemSortOrder: 'a6',
    nullable: false,
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
      'Integer minor units. DERIVED - it must equal the sum of the grouped payments, and ' +
      'createBankDeposit is what computes it. A deposit whose total disagrees with its ' +
      'payments cannot match the bank line it exists to match',
  },

  payments: {
    id: toFieldId('payments'),
    key: 'payments',
    label: 'Payments',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'bank_deposit_payments',
    systemSortOrder: 'a7',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'payment:bankDeposit' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'The payments banked together in this deposit',
  },

  bankTransactionId: {
    id: toFieldId('bankTransactionId'),
    key: 'bankTransactionId',
    label: 'Bank Transaction ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_deposit_bank_transaction_id',
    systemSortOrder: 'a8',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The imported bank statement line this deposit matches. Null until a feed is ' +
      'connected and the match is made. Same name and semantics as ' +
      'the vendor payment side twin, so the matcher has ONE shape to look for',
  },

  clearedAt: {
    id: toFieldId('clearedAt'),
    key: 'clearedAt',
    label: 'Cleared At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'bank_deposit_cleared_at',
    systemSortOrder: 'a9',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'When the bank actually credited the deposit. Null while it is in transit',
  },

  reconciledAt: {
    id: toFieldId('reconciledAt'),
    key: 'reconciledAt',
    label: 'Reconciled At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'bank_deposit_reconciled_at',
    systemSortOrder: 'aA',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'When a human signed off that this deposit matches the statement. Separate from ' +
      'clearedAt on purpose - the bank crediting a line is not the same as somebody agreeing it',
  },

  glPostingId: {
    id: toFieldId('glPostingId'),
    key: 'glPostingId',
    label: 'GL Posting',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_deposit_gl_posting_id',
    systemSortOrder: 'aB',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The GlPosting row this deposit produced. A denormalized backlink for the drawer - ' +
      'the AUTHORITY is the posting own sourceType/sourceId pair',
  },

  // The last-rendered deposit slip, as a single FILE value (plans/accounting/
  // ui-plan.md §5.3, the `invoice_pdf_asset` shape). Written ONLY by
  // `ensureDocumentPdf`; `updatable: false` is what keeps every human door shut.
  //
  // 🛑 Never make this user-writable. `ensureDocumentPdf` reads the pointer,
  // loads that MediaAsset and appends a new VERSION whenever the content hash
  // disagrees. A file a person uploaded has no `contentHash` at all, so the
  // comparison always fails and the next render would silently republish their
  // file as our slip - and a missing pointer leaks a fresh MediaAsset per render.
  pdfAsset: {
    id: toFieldId('pdfAsset'),
    key: 'pdfAsset',
    label: 'Deposit Slip',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'bank_deposit_pdf_asset',
    systemSortOrder: 'aC',
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
    description: 'The generated deposit slip PDF for this deposit',
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
    description: 'Automatically set when the deposit is created',
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
    description: 'Automatically updated when the deposit is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
