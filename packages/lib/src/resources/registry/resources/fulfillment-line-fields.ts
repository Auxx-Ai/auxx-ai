// packages/lib/src/resources/registry/resources/fulfillment-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Fulfillment Line resource
 * (`plans/money/tasks/55-shipment-lines.md` §3).
 *
 * One record per `(fulfillment, line_item)` tuple: units of ONE order line
 * that went out in ONE dispatch. Hidden (`isVisible: false`), no route
 * folder, managed entirely from the parent `fulfillment` - the same treatment
 * `credit_memo_line` and `purchase_order_line` get.
 *
 * Deliberately carries no part, no date, and no money. The part is reached
 * through `line_item_part`, the date through the parent fulfillment's
 * `fulfillment_shipped_at`, and the money never existed per line in the old
 * JSON log either - each would be a second copy that can go stale.
 *
 * The identity Shopify supplies for the connector to bind on is
 * `${fulfillmentId}:${lineItemId}` - REST gives no id of its own for a
 * fulfillment line, but both halves here are real Shopify ids (stronger than
 * the tax-line precedent, which synthesises from a title because a Shopify
 * tax line carries no id at all). That identity is a connector-side concern
 * (§5 of the brief) and is not a field on this def.
 */
export const FULFILLMENT_LINE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique fulfillment line identifier',
  },

  /** The dispatch this line belongs to. The owning side of `fulfillment_lines`. */
  fulfillment: {
    id: toFieldId('fulfillment'),
    key: 'fulfillment',
    label: 'Fulfillment',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'fulfillment_line_fulfillment',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'fulfillment:lines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'fulfillment',
      relationshipType: 'belongs_to',
      inverseName: 'Lines',
      inverseSystemAttribute: 'fulfillment_lines',
    },
    description: 'The dispatch this line belongs to',
  },

  /**
   * The order line these units shipped against. Bound from Shopify's
   * `line_item_id` on the connector path - the line item already exists as
   * its own record from the order fan-out, so this LINKS rather than mints
   * (the connector's `reference` link mode, §5 of the brief).
   */
  lineItem: {
    id: toFieldId('lineItem'),
    key: 'lineItem',
    label: 'Line Item',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'fulfillment_line_line_item',
    systemSortOrder: 'a2',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'line_item:fulfillmentLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'line_item',
      relationshipType: 'belongs_to',
      inverseName: 'Fulfillment Lines',
      inverseSystemAttribute: 'line_item_fulfillment_lines',
    },
    description:
      'The order line these units shipped against - links to the existing line item record ' +
      'rather than minting one',
  },

  /** Units of the line shipped in THIS dispatch - not the line's total, not cumulative. */
  quantity: {
    id: toFieldId('quantity'),
    key: 'quantity',
    label: 'Quantity',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'fulfillment_line_quantity',
    systemSortOrder: 'a3',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description: 'Units of the line item shipped in THIS dispatch only - never cumulative',
  },

  /**
   * 🔑 The exact mirror of `purchase_order_line_quantity_received`: re-SUMmed
   * whole by a post-hook over `stock_movement_fulfillment_line`, never
   * incremented in place, with `field-hooks/post/purchase-order-line-rollups.ts`
   * as the template (plans/money/tasks/50-batch-inventory-relief.md). The
   * subledger is the truth and a hand-maintained copy of it diverges silently -
   * same reason `part_quantity_on_hand` is computed rather than typed.
   */
  quantityRelieved: {
    id: toFieldId('quantityRelieved'),
    key: 'quantityRelieved',
    label: 'Qty Relieved',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'fulfillment_line_quantity_relieved',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'Re-SUMmed whole from stock_movement_fulfillment_line by a post-hook, never ' +
      'incremented - the same shape as purchase_order_line_quantity_received and for the ' +
      'same reason: the subledger is the truth',
  },

  // Reverse relationship: stockMovements (from stock_movement.fulfillmentLine).
  // The sell-side mirror of `purchase_order_line.stockMovements` - what
  // `quantityRelieved` re-sums over, and all of task 50's netting.
  stockMovements: {
    id: toFieldId('stockMovements'),
    key: 'stockMovements',
    label: 'Stock Movements',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'fulfillment_line_stock_movements',
    systemSortOrder: 'a5',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'stock_movement:fulfillmentLine' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description: 'The stock movements that relieved this line - what quantityRelieved re-sums over',
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
    description: 'Automatically set when the fulfillment line is created',
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
    description: 'Automatically updated when the fulfillment line is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
