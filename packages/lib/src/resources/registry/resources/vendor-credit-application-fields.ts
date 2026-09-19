// packages/lib/src/resources/registry/resources/vendor-credit-application-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { defineResourceFields } from '../system-attributes'

/**
 * Field definitions for the Vendor Credit Application resource — one row per
 * "this much of this credit went against this bill" (task 71 §5 U7).
 *
 * The mirror of `credit_memo_application`, and an entity for the same reason:
 * an application is not money. It posts NO ledger entry at all — the credit's
 * issue entry already debited the payable and the bill's entry credited it — so
 * the application is subledger truth only, and what moves is
 * `vendor_bill_amount_credited` and the bill's balance.
 *
 * Only `purchasing/vendor-credit/apply.ts` writes rows here. Money is integer
 * minor units.
 */
export const VENDOR_CREDIT_APPLICATION_FIELDS = defineResourceFields({
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
    description: 'Unique vendor credit application identifier',
  },

  /** The credit being applied. The owning side of `vendor_credit_applications`. */
  vendorCredit: {
    id: toFieldId('vendorCredit'),
    key: 'vendorCredit',
    label: 'Vendor Credit',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_credit_application_vendor_credit',
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
      inverseResourceFieldId: 'vendor_credit:applications' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_credit',
      relationshipType: 'belongs_to',
      inverseName: 'Applications',
      inverseSystemAttribute: 'vendor_credit_applications',
    },
    description: 'The vendor credit this application draws on',
  },

  /**
   * The bill being reduced. The owning side of
   * `vendor_bill_credit_applications`, which is `restrict`: a bill with credit
   * applied cannot be deleted.
   */
  vendorBill: {
    id: toFieldId('vendorBill'),
    key: 'vendorBill',
    label: 'Vendor Bill',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_credit_application_vendor_bill',
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
      inverseResourceFieldId: 'vendor_bill:creditApplications' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_bill',
      relationshipType: 'belongs_to',
      inverseName: 'Credit Applications',
      inverseSystemAttribute: 'vendor_bill_credit_applications',
    },
    description: 'The vendor bill this application reduces',
  },

  // Greater than zero, at most the credit balance and at most the bill balance
  // at the time. `applyVendorCredit` refuses over either.
  amount: {
    id: toFieldId('amount'),
    key: 'amount',
    label: 'Amount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_credit_application_amount',
    systemSortOrder: 'a3',
    nullable: false,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'How much of the credit went against the bill, integer minor units - capped at both ' +
      'balances at the time of application',
  },

  appliedAt: {
    id: toFieldId('appliedAt'),
    key: 'appliedAt',
    label: 'Applied',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'vendor_credit_application_applied_at',
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
    description: 'When the credit was applied to the bill',
  },

  operation: {
    id: toFieldId('operation'),
    key: 'operation',
    label: 'Operation',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_credit_application_operation',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description: 'Whether this record applies credit or reverses an earlier application.',
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
})
