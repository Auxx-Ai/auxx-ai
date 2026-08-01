// packages/lib/src/resources/registry/resources/payment-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/** How a payment was collected (money MI1 build spec §B.2). */
export const PAYMENT_METHOD_OPTIONS = [
  { label: 'Cash', value: 'cash', color: 'green' },
  { label: 'Check', value: 'check', color: 'blue' },
  { label: 'Card', value: 'card', color: 'purple' },
  { label: 'Bank transfer', value: 'bank', color: 'teal' },
  { label: 'Other', value: 'other', color: 'gray' },
] as const

/**
 * Field definitions for the Payment resource (money MI1, README) — a hidden entity
 * mirroring `PaymentTransaction` ledger rows (§E). Never created via the generic
 * dialog/Kopilot — the `requireLedgerProvenance` system hook (§F.3) is the gate; the
 * ledger's own `handler.create` is the sole sanctioned writer.
 */
export const PAYMENT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique payment identifier',
  },

  amount: {
    id: toFieldId('amount'),
    key: 'amount',
    label: 'Amount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'payment_amount',
    systemSortOrder: 'a1',
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
      updatable: true, // updates are rejected by requireLedgerProvenance (§F.3), not capability
      configurable: false,
    },
    description: 'Integer cents (MQ1 convention) — mirrors the ledger row amount',
  },

  date: {
    id: toFieldId('date'),
    key: 'date',
    label: 'Date',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'payment_date',
    systemSortOrder: 'a2',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select payment date',
  },

  method: {
    id: toFieldId('method'),
    key: 'method',
    label: 'Method',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'payment_method',
    systemSortOrder: 'a3',
    nullable: false,
    options: { options: [...PAYMENT_METHOD_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select method',
    defaultValue: 'cash',
  },

  reference: {
    id: toFieldId('reference'),
    key: 'reference',
    label: 'Reference',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payment_reference',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Check #, last 4, …',
    description: 'Check number, card last4, or other reference detail',
  },

  note: {
    id: toFieldId('note'),
    key: 'note',
    label: 'Note',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payment_note',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter a note',
  },

  invoice: {
    id: toFieldId('invoice'),
    key: 'invoice',
    label: 'Invoice',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'payment_invoice',
    systemSortOrder: 'a6',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true, // updates are rejected by requireLedgerProvenance (§F.3), not capability
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'invoice:payments' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'invoice',
      relationshipType: 'belongs_to',
      inverseName: 'Payments',
      inverseSystemAttribute: 'invoice_payments',
    },
    description: 'Invoice this payment applies to',
  },

  transactionId: {
    id: toFieldId('transactionId'),
    key: 'transactionId',
    label: 'Transaction ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payment_transaction_id',
    systemSortOrder: 'a7',
    showInPanel: false,
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true, // updates are rejected by requireLedgerProvenance (§F.3), not capability
      configurable: false,
    },
    description:
      'Ledger backlink AND the provenance gate (§F.3) — creates without it are rejected, ' +
      'so the ledger stays the only writer',
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
    description: 'Automatically set when the payment is created',
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
    description: 'Automatically updated when the payment is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
