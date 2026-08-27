// packages/lib/src/resources/registry/resources/vendor-payment-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { VendorPaymentStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Vendor Payment resource — the A/P-side payment
 * HEADER, one row per money movement (one ACH, one check, one bank statement
 * line) (plans/purchasing/01-build-plan.md §5.4).
 *
 * 🛑 **This entity ships INERT (decision P13).** The def and every field below
 * exist in every org from day one, but **nothing writes them**: no router
 * procedure, no UI, no hook, `isVisible: false`, and no seeding — not even
 * demo data. That is the whole point. A def with **zero rows can be reshaped
 * for free**; the first row ends that, because from then on any change to the
 * shape costs a data migration. Shipping the def now buys the expensive half
 * (one trip through the registration set, one org-cache rollout, no def-exists
 * gate to wait on later) while the cheap-to-defer half — the write path — stays
 * deferred until there is real usage to design it against.
 *
 * The fields here are ordinary **creatable** fields. They are not marked
 * `creatable: false` to enforce inertness — that is a *no writer exists yet*
 * fact, not a capability fact, and confusing the two would make switch-on a
 * registry edit instead of the four-step non-migration it is meant to be. The
 * one genuine exception is {@link VENDOR_PAYMENT_FIELDS.unallocated}, which is
 * derived and never settable.
 *
 * **Why a header rather than a flat payment-per-bill (decision P15).** The
 * AR-side `payment` carries a single `payment_invoice` belongs_to, and mirroring
 * it exactly was the original plan (P14). It was superseded the same day on a
 * checked fact rather than a prediction: vendor payments **have** been batched,
 * rarely but genuinely. Rare argues *for* the header — a flat model carries the
 * common case correctly and mis-shapes the uncommon one, which is the failure
 * nobody designs for and nobody notices. Header + allocation is also a strict
 * superset: one payment against one bill is one allocation row, so nothing is
 * traded away.
 *
 * ```
 * vendor_payment              amount 4312.18   <- one ACH, one bank statement line
 *   |- allocation  bill INV-4471   1200.00
 *   |- allocation  bill INV-4488   2412.18
 *   `- allocation  bill INV-4502    700.00
 * ```
 *
 * Money is stored in **integer minor units** throughout, the MQ1 convention the
 * rest of the money documents already use.
 *
 * ⚠️ One transition to plan for at switch-on: while this entity is inert,
 * `vendor_bill.amountPaid` is written directly. Once payments exist it becomes
 * derived from the sum of allocations, and those cannot both be true.
 */
export const VENDOR_PAYMENT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique vendor payment identifier',
  },

  vendor: {
    id: toFieldId('vendor'),
    key: 'vendor',
    label: 'Vendor',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_payment_vendor',
    systemSortOrder: 'a1',
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
      inverseResourceFieldId: 'company:vendorPayments' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'company',
      relationshipType: 'belongs_to',
      inverseName: 'Vendor Payments',
      inverseSystemAttribute: 'company_vendor_payments',
    },
    description:
      'The company being paid — required. A payment with no payee cannot be allocated, ' +
      'reconciled against a bank line, or 1099-reported later',
  },

  amount: {
    id: toFieldId('amount'),
    key: 'amount',
    label: 'Amount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_payment_amount',
    systemSortOrder: 'a2',
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
      required: true,
      configurable: false,
    },
    description:
      'The WHOLE payment in integer minor units — what left the bank, not any one ' +
      "bill's share. A bill's share is an allocation row",
  },

  paidAt: {
    id: toFieldId('paidAt'),
    key: 'paidAt',
    label: 'Paid At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'vendor_payment_paid_at',
    systemSortOrder: 'a3',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select payment date',
    description: 'When the payment was issued — distinct from when it cleared the bank',
  },

  method: {
    id: toFieldId('method'),
    key: 'method',
    label: 'Method',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_payment_method',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'ACH, check, card, wire',
    description:
      'How the money moved. Free text rather than the AR-side enum: the A/P vocabulary ' +
      'is set by whatever the bank feed calls it, and no writer exists yet to pin it down',
  },

  reference: {
    id: toFieldId('reference'),
    key: 'reference',
    label: 'Reference',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_payment_reference',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Check no., ACH trace, wire ref',
    description:
      'Check number or ACH trace, human-entered. This is what a vendor quotes back on the ' +
      'phone, so it is a lookup key even though it is not an identity',
  },

  note: {
    id: toFieldId('note'),
    key: 'note',
    label: 'Note',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_payment_note',
    systemSortOrder: 'a6',
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

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'vendor_payment_status',
    systemSortOrder: 'a7',
    nullable: false,
    options: { options: VendorPaymentStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: VendorPaymentStatus.DRAFT,
    description:
      'draft, posted or void. A bounced ACH is ONE header to void — the reason the header ' +
      'exists at all, since a flat model would be three rows to undo in step',
  },

  bankTransactionId: {
    id: toFieldId('bankTransactionId'),
    key: 'bankTransactionId',
    label: 'Bank Transaction ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_payment_bank_transaction_id',
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
      'The imported bank statement line this payment matches. Null until a feed is ' +
      'connected and the match is made',
  },

  clearedAt: {
    id: toFieldId('clearedAt'),
    key: 'clearedAt',
    label: 'Cleared At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'vendor_payment_cleared_at',
    systemSortOrder: 'a9',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'When the bank actually took the money. Null while the payment is in flight',
  },

  reconciledAt: {
    id: toFieldId('reconciledAt'),
    key: 'reconciledAt',
    label: 'Reconciled At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'vendor_payment_reconciled_at',
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
      'When a human signed off that this payment matches the statement. Separate from ' +
      'clearedAt on purpose — the bank clearing a line is not the same as somebody agreeing it',
  },

  unallocated: {
    id: toFieldId('unallocated'),
    key: 'unallocated',
    label: 'Unallocated',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_payment_unallocated',
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
      creatable: false, // derived: amount - SUM(allocations); never settable
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'Derived as amount minus the sum of this payment allocations, in integer minor ' +
      'units. A NON-ZERO value is a VENDOR CREDIT — money sitting with the vendor that ' +
      'no bill has claimed yet, which is exactly the balance a flat payment-per-bill ' +
      'model has nowhere to put',
  },

  // Reverse relationship: allocations (from vendor_payment_allocation.payment).
  allocations: {
    id: toFieldId('allocations'),
    key: 'allocations',
    label: 'Allocations',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_payment_allocations',
    systemSortOrder: 'aC',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_payment_allocation:payment' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'One allocation row per bill this payment covers',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'aD',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the vendor payment is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'aE',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the vendor payment is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
