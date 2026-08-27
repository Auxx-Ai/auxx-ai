// packages/lib/src/resources/registry/resources/vendor-bill-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Vendor Bill Line resource — one row per line on a
 * vendor's invoice (plans/purchasing/01-build-plan.md §5.2).
 *
 * Hidden system entity (`isVisible: false`), managed from the bill it belongs
 * to — the `subpart` / `vendor_part` precedent. It has no list of its own and
 * no detail page; a bill line only means anything beside its siblings.
 *
 * Every value here is TRANSCRIBED from the vendor's document rather than
 * derived. That is the point: `purchaseOrderLine` carries what we expected and
 * the receipts carry what arrived, so the match has three independent readings
 * to compare. Recomputing a line from the PO would collapse two of them into
 * one and there would be nothing left to disagree.
 */
export const VENDOR_BILL_LINE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique vendor bill line identifier',
  },

  vendorBill: {
    id: toFieldId('vendorBill'),
    key: 'vendorBill',
    label: 'Vendor Bill',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_vendor_bill',
    systemSortOrder: 'a1',
    showInPanel: false, // lines are viewed in the context of their bill
    nullable: false,
    required: true,
    // Leg 1 of the natural key. A bill line has no identity of its own — the
    // vendor's line numbering is theirs and repeats across documents — so the
    // parent bill is the only stable half of it.
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_bill:lines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_bill',
      relationshipType: 'belongs_to',
      inverseName: 'Lines',
      inverseSystemAttribute: 'vendor_bill_lines',
    },
    description: 'The bill this line belongs to — required',
  },

  // THE MATCH KEY. Nullable, because a bill line with no PO line behind it is
  // legal (freight, a one-off, a line the vendor invented) — but where it IS
  // set, this edge is what lets the three-way match line up billed quantity and
  // price against ordered and received. Nothing else joins the three readings.
  purchaseOrderLine: {
    id: toFieldId('purchaseOrderLine'),
    key: 'purchaseOrderLine',
    label: 'Purchase Order Line',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_purchase_order_line',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'purchase_order_line:vendorBillLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'purchase_order_line',
      relationshipType: 'belongs_to',
      inverseName: 'Vendor Bill Lines',
      inverseSystemAttribute: 'purchase_order_line_vendor_bill_lines',
    },
    description:
      'The PO line this bill line is against — THE MATCH KEY. Null for a line with no purchase ' +
      'order behind it, which is legal and simply cannot be matched.',
  },

  // Stamped from the PO line at write, not hand-set — provenance and grouping
  // only. No inverse field is declared on `part`: `part_vendor_bill_lines` is
  // not a registered system attribute, so `linkNewRelationships` leaves this
  // edge one-way until one exists.
  part: {
    id: toFieldId('part'),
    key: 'part',
    label: 'Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_part',
    systemSortOrder: 'a3',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'part:vendorBillLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    description:
      'Part this line is for — STAMPED from the PO line at write, not hand-set. Provenance and ' +
      'spend-by-part grouping only, never a pricing or matching input.',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_description',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter description',
    description: 'What the vendor called it on their document — kept verbatim, not normalised',
  },

  quantityBilled: {
    id: toFieldId('quantityBilled'),
    key: 'quantityBilled',
    label: 'Qty Billed',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_quantity_billed',
    systemSortOrder: 'a5',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: 1,
    description:
      'How many the vendor billed for — the quantity the match compares against what was ' +
      'received, not a copy of it',
  },

  unitPrice: {
    id: toFieldId('unitPrice'),
    key: 'unitPrice',
    label: 'Unit Price',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_unit_price',
    systemSortOrder: 'a6',
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
      'What the vendor charged per unit, integer minor units — a BUY price, in contrast to ' +
      '`line_item.unitPrice`, which is what we SELL for. The two never belong in the same column.',
  },

  lineTotal: {
    id: toFieldId('lineTotal'),
    key: 'lineTotal',
    label: 'Line Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_line_total',
    systemSortOrder: 'a7',
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
      'The extended amount the vendor billed, integer minor units — transcribed, NOT recomputed ' +
      "from qty x price. Recomputing would quietly correct the vendor's own arithmetic, which is " +
      'exactly the discrepancy the match exists to catch.',
  },

  // An account CODE — '2160', '5090' — never a provider account id (P2). The
  // ledger is ours and the accounting system is an exporter; the provider's id
  // for an account lives on `gl_account`, where it can change without touching
  // a single line.
  glAccount: {
    id: toFieldId('glAccount'),
    key: 'glAccount',
    label: 'GL Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_gl_account',
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '2160',
    description:
      "The account CODE this line posts to — '2160' (GRNI) for a PO-matched line, an expense " +
      'code otherwise. A code, never a provider account id.',
  },

  sortOrder: {
    id: toFieldId('sortOrder'),
    key: 'sortOrder',
    label: 'Sort Order',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_sort_order',
    systemSortOrder: 'a9',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: "Keeps the lines in the order they appear on the vendor's document",
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
    description: 'Automatically set when the bill line is created',
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
    description: 'Automatically updated when the bill line is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
