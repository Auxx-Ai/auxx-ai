// packages/lib/src/resources/registry/resources/vendor-payment-allocation-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Vendor Payment Allocation resource — one row per
 * bill that a single {@link VENDOR_PAYMENT_FIELDS vendor payment} covers
 * (plans/purchasing/01-build-plan.md §5.4, decision P15).
 *
 * 🛑 **This entity ships INERT (decision P13), exactly as its header does.**
 * The def and its fields exist in every org from day one and **nothing writes
 * them**: no router procedure, no UI, no hook, `isVisible: false`, no seeding,
 * no demo rows. The condition attached to P13 is that both tables stay EMPTY —
 * a def with **zero rows can be reshaped for free**, and the first row ends
 * that, because after it any change to the shape is a data migration. Building
 * the def early is cheap and reversible; building the write path early is not,
 * and stays deferred.
 *
 * The fields are ordinary **creatable** fields. Inertness is the absence of a
 * writer, not a capability flag — marking them `creatable: false` would turn
 * switch-on into a registry edit instead of the write-path-plus-surface it is
 * meant to be.
 *
 * **Why the allocation exists at all.** Vendor payments have been batched —
 * rarely, but genuinely (confirmed 2026-08-26, decision P15). A flat
 * payment-per-bill model carries the common case correctly and mis-shapes the
 * uncommon one, and the batched payments are precisely the ones a bank import
 * has to match. Header plus allocation is a strict superset: one payment
 * against one bill is one allocation row, so the simple case loses nothing.
 *
 * `(payment, vendorBill)` is the natural key — see the `naturalKeyPosition`
 * declarations below. This resource never deserves a list of its own; it is
 * read through the payment or the bill.
 */
export const VENDOR_PAYMENT_ALLOCATION_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique vendor payment allocation identifier',
  },

  payment: {
    id: toFieldId('payment'),
    key: 'payment',
    label: 'Payment',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_payment_allocation_payment',
    systemSortOrder: 'a1',
    showInPanel: false, // allocations are read in the context of their payment or bill
    nullable: false,
    required: true,
    // Leg 1 of the natural key `(payment, vendorBill)`. An allocation has no
    // unique field of its own — `amount` is a number that repeats freely — so
    // this pair is the only identity it has, and the only thing that stops the
    // same payment being applied to the same bill twice.
    naturalKeyPosition: 1,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_payment:allocations' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_payment',
      relationshipType: 'belongs_to',
      inverseName: 'Allocations',
      inverseSystemAttribute: 'vendor_payment_allocations',
    },
    description: 'The payment header this allocation belongs to — required',
  },

  vendorBill: {
    id: toFieldId('vendorBill'),
    key: 'vendorBill',
    label: 'Vendor Bill',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_payment_allocation_vendor_bill',
    systemSortOrder: 'a2',
    nullable: false,
    required: true,
    // Leg 2 of the natural key `(payment, vendorBill)`. See the `payment` leg.
    naturalKeyPosition: 2,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_bill:paymentAllocations' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_bill',
      relationshipType: 'belongs_to',
      inverseName: 'Payment Allocations',
      inverseSystemAttribute: 'vendor_bill_payment_allocations',
    },
    description: 'The bill this slice of the payment relieves — required',
  },

  amount: {
    id: toFieldId('amount'),
    key: 'amount',
    label: 'Amount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_payment_allocation_amount',
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
      required: true,
      configurable: false,
    },
    description:
      "This bill's share of the payment, in integer minor units. The shares need not sum " +
      'to the header amount — what is left over is the payment unallocated balance, a ' +
      'vendor credit',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a4',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the allocation is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'a5',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the allocation is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
