// packages/lib/src/resources/registry/resources/credit-memo-application-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Credit Memo Application resource
 * (plans/accounting/tasks/10-credit-memos.md §2.3, §10.4).
 *
 * One row per "this much of this memo went against this invoice". Hidden;
 * the memo's settlement card and the invoice's credits card render it.
 *
 * Why an entity and not a `PaymentAllocation` row: an application is not
 * money, and a `PaymentAllocation` needs a `PaymentTransaction` to hang off.
 * Manufacturing a fake transaction would post a payment entry for money that
 * never moved. An application posts NO ledger entry at all (§3.3): the memo
 * entry already credited receivable and the invoice entry debited it, so the
 * application is subledger truth only. That is exactly why the invoice side
 * carries a derived `invoice_amount_credited` that `syncInvoicePaymentState`
 * subtracts from the balance.
 *
 * Only `money/credit-memos/apply.ts` writes rows here, and every write ends by
 * re-running the invoice payment sync and the memo settlement. Money is
 * integer minor units.
 */
export const CREDIT_MEMO_APPLICATION_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique credit application identifier',
  },

  /** The memo being applied. The owning side of `credit_memo_applications`. */
  creditMemo: {
    id: toFieldId('creditMemo'),
    key: 'creditMemo',
    label: 'Credit Memo',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'credit_memo_application_credit_memo',
    systemSortOrder: 'a1',
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
      inverseResourceFieldId: 'credit_memo:applications' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'credit_memo',
      relationshipType: 'belongs_to',
      inverseName: 'Applications',
      inverseSystemAttribute: 'credit_memo_applications',
    },
    description: 'The credit memo this application draws on',
  },

  /**
   * The invoice being reduced. The owning side of `invoice_credit_applications`,
   * which is `restrict`: an invoice with credit applied cannot be deleted, the
   * way `invoice_payments` refuses.
   */
  invoice: {
    id: toFieldId('invoice'),
    key: 'invoice',
    label: 'Invoice',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'credit_memo_application_invoice',
    systemSortOrder: 'a2',
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
      inverseResourceFieldId: 'invoice:creditApplications' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'invoice',
      relationshipType: 'belongs_to',
      inverseName: 'Credit Applications',
      inverseSystemAttribute: 'invoice_credit_applications',
    },
    description: 'The invoice this application reduces',
  },

  // Greater than zero, at most the memo balance and at most the invoice
  // balance at the time. `applyCreditMemo` refuses over either.
  amount: {
    id: toFieldId('amount'),
    key: 'amount',
    label: 'Amount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'credit_memo_application_amount',
    systemSortOrder: 'a3',
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
      'How much of the memo went against the invoice, integer minor units - capped at both ' +
      'balances at the time of application',
  },

  appliedAt: {
    id: toFieldId('appliedAt'),
    key: 'appliedAt',
    label: 'Applied',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'credit_memo_application_applied_at',
    systemSortOrder: 'a4',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select application date',
    description: 'When the credit was applied to the invoice',
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
    description: 'Automatically set when the application is created',
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
    description: 'Automatically updated when the application is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
