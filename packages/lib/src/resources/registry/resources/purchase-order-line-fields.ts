// packages/lib/src/resources/registry/resources/purchase-order-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { RATE_DECIMALS } from '@auxx/utils/currency'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Purchase Order Line resource — one part, one
 * quantity, one expected price on a purchase order
 * (plans/purchasing/01-build-plan.md §4.2).
 *
 * Hidden system def (`isVisible: false`), managed entirely from its parent
 * order — the `subpart` / `vendor_part` precedent. A PO line has no life of its
 * own: it is created with the order, received against, and billed against.
 *
 * It is deliberately NOT a `line_item`. A `line_item` carries sell-side
 * semantics (taxable, optional, per-line discount) and is bound to the
 * quote/order/invoice union that `LineBuilder` branches on. A PO line has a buy
 * price and none of that vocabulary, so it is a separate entity rather than a
 * fifth arm that opts out of most of the behaviour.
 *
 * `quantityReceived` and `quantityBilled` are the subledger read backwards and
 * are never typed — see their descriptions.
 */
export const PURCHASE_ORDER_LINE_FIELDS: Record<string, ResourceField> = {
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
  },

  purchaseOrder: {
    id: toFieldId('purchaseOrder'),
    key: 'purchaseOrder',
    label: 'Purchase Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'purchase_order_line_purchase_order',
    systemSortOrder: 'a1',
    showInPanel: false, // lines are viewed in the context of their order
    nullable: false,
    required: true,
    // Leg 1 of the natural key `(purchaseOrder, part)`. A PO line has no unique
    // field of its own, so this pair is the only identity it has — and the only
    // way a re-imported or re-sent order updates its lines rather than doubling
    // them.
    naturalKeyPosition: 1,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'purchase_order:lines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'purchase_order',
      relationshipType: 'belongs_to',
      inverseName: 'Lines',
      inverseSystemAttribute: 'purchase_order_lines',
    },
  },

  part: {
    id: toFieldId('part'),
    key: 'part',
    label: 'Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'purchase_order_line_part',
    systemSortOrder: 'a2',
    nullable: false,
    required: true,
    // Leg 2 of the natural key `(purchaseOrder, part)`. See the order leg above.
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
      inverseResourceFieldId: 'part:purchaseOrderLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'part',
      relationshipType: 'belongs_to',
      inverseName: 'Purchase Order Lines',
      inverseSystemAttribute: 'part_purchase_order_lines',
    },
    // The part is what receiving moves into stock, so it is required even when
    // the supplier's own catalogue entry is unknown.
  },

  vendorPart: {
    id: toFieldId('vendorPart'),
    key: 'vendorPart',
    label: 'Supplier Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'purchase_order_line_vendor_part',
    systemSortOrder: 'a3',
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_part:purchaseOrderLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_part',
      relationshipType: 'belongs_to',
      inverseName: 'Purchase Order Lines',
      inverseSystemAttribute: 'vendor_part_purchase_order_lines',
    },
    // Optional: a one-off buy from a supplier with no maintained price list is
    // still a legitimate line, and forcing a `vendor_part` row for it would
    // pollute the pricing catalogue.
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'purchase_order_line_description',
    systemSortOrder: 'a4',
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter line description',
    // What the SUPPLIER calls it. Printing our own part name on their order is
    // how a picking error becomes a dispute.
  },

  quantityOrdered: {
    id: toFieldId('quantityOrdered'),
    key: 'quantityOrdered',
    label: 'Qty Ordered',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'purchase_order_line_quantity_ordered',
    systemSortOrder: 'a5',
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Enter quantity',
  },

  quantityReceived: {
    id: toFieldId('quantityReceived'),
    key: 'quantityReceived',
    label: 'Qty Received',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'purchase_order_line_quantity_received',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    // Same shape as `part_quantity_on_hand`, and for the same reason: the
    // subledger is the truth, and a hand-maintained copy of it diverges
    // silently. Re-summed whole, post-commit — never incremented in place.
  },

  quantityBilled: {
    id: toFieldId('quantityBilled'),
    key: 'quantityBilled',
    label: 'Qty Billed',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'purchase_order_line_quantity_billed',
    systemSortOrder: 'a7',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    // The billed leg of the three-way match. Typing it would let the control be
    // satisfied by the person the control exists to check.
  },

  expectedUnitPrice: {
    id: toFieldId('expectedUnitPrice'),
    key: 'expectedUnitPrice',
    label: 'Expected Unit Price',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'purchase_order_line_expected_unit_price',
    systemSortOrder: 'a8',
    nullable: true,
    // RATE, not amount: per-each (plans/money/tasks/31-sub-cent-rates.md §2.2).
    options: {
      currencyCode: 'USD',
      decimals: RATE_DECIMALS,
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
    // Expected, not actual: the price agreed when the order went out, which the
    // three-way match holds the arriving invoice against. The received price
    // lives on the movement.
  },

  lineTotal: {
    id: toFieldId('lineTotal'),
    key: 'lineTotal',
    label: 'Line Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'purchase_order_line_line_total',
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
      creatable: false, // totals engine is the only writer
      updatable: false,
      configurable: false,
    },
  },

  weight: {
    id: toFieldId('weight'),
    key: 'weight',
    label: 'Weight',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'purchase_order_line_weight',
    systemSortOrder: 'aA',
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter line weight',
    // Only the `weight` allocation basis reads it, so leaving it empty costs
    // nothing until someone picks that basis.
  },

  sortOrder: {
    id: toFieldId('sortOrder'),
    key: 'sortOrder',
    label: 'Sort Order',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'purchase_order_line_sort_order',
    systemSortOrder: 'aB',
    showInPanel: false,
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  // Reverse relationship: stockMovements (from stock_movement.purchaseOrderLine).
  // The `stock_movement` side lands with phase 1; until it does,
  // `linkNewRelationships` leaves this unlinked and links it when the
  // counterpart appears.
  stockMovements: {
    id: toFieldId('stockMovements'),
    key: 'stockMovements',
    label: 'Stock Movements',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'purchase_order_line_stock_movements',
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
      inverseResourceFieldId: 'stock_movement:purchaseOrderLine' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
  },

  // Reverse relationship: vendorBillLines (from vendor_bill_line.purchaseOrderLine).
  // The `vendor_bill_line` side lands with phase 4; until it does,
  // `linkNewRelationships` leaves this unlinked and links it when the
  // counterpart appears.
  vendorBillLines: {
    id: toFieldId('vendorBillLines'),
    key: 'vendorBillLines',
    label: 'Bill Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'purchase_order_line_vendor_bill_lines',
    systemSortOrder: 'aD',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_bill_line:purchaseOrderLine' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
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
  },

  createdBy: CREATED_BY_FIELD,
}
