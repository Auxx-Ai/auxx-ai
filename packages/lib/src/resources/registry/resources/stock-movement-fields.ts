// packages/lib/src/resources/registry/resources/stock-movement-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { StockMovementCostBasis, StockMovementType } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Stock Movement resource.
 * Stock movements are append-only ledger entries tracking inventory changes.
 *
 * **Every field here is `updatable: false`, and that is load-bearing.** The
 * ledger is append-only by construction, which is the only reason a cost frozen
 * onto a movement can be trusted years later. A correction is a new, opposite
 * row (see `reversesMovement`), never an edit.
 *
 * The receiving fields below (plans/purchasing/01-build-plan.md §2) are what
 * turn this from a quantity ledger into a costed subledger. Before them the
 * system knew *how many* motors arrived and had never known *what they cost* —
 * the only price it stored was one overwritable field on `vendor_part`.
 */
export const STOCK_MOVEMENT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique stock movement identifier',
  },

  part: {
    id: toFieldId('part'),
    key: 'part',
    label: 'Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'stock_movement_part',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'part:stockMovements' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'part',
      relationshipType: 'belongs_to',
      inverseName: 'Stock Movements',
      inverseSystemAttribute: 'part_stock_movements',
    },
    description: 'The part this movement applies to',
  },

  type: {
    id: toFieldId('type'),
    key: 'type',
    label: 'Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'stock_movement_type',
    systemSortOrder: 'a2',
    nullable: false,
    options: { options: StockMovementType.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    description: 'Type of stock movement',
  },

  quantity: {
    id: toFieldId('quantity'),
    key: 'quantity',
    label: 'Quantity',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'stock_movement_quantity',
    systemSortOrder: 'a3',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    placeholder: 'Enter quantity',
    description: 'Quantity changed (positive or negative)',
  },

  reason: {
    id: toFieldId('reason'),
    key: 'reason',
    label: 'Reason',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'stock_movement_reason',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    placeholder: 'Enter reason',
    description: 'Reason for the stock movement',
  },

  reference: {
    id: toFieldId('reference'),
    key: 'reference',
    label: 'Reference',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'stock_movement_reference',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    placeholder: 'Enter reference',
    description: 'External reference (e.g., build batch ID)',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a6',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'When the stock movement was created',
  },

  adjustSubparts: {
    id: toFieldId('adjustSubparts'),
    key: 'adjustSubparts',
    label: 'Adjust Subparts',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'stock_movement_adjust_subparts',
    systemSortOrder: 'a7',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description: 'Whether to cascade this adjustment to leaf subparts via BOM explosion',
  },

  parentMovement: {
    id: toFieldId('parentMovement'),
    key: 'parentMovement',
    label: 'Parent Movement',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'stock_movement_parent_movement',
    systemSortOrder: 'a8',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    relationshipConfig: {
      relatedEntityType: 'stock_movement',
      relationshipType: 'belongs_to',
      inverseName: 'Child Movements',
      inverseSystemAttribute: 'stock_movement_child_movements',
    },
    description: 'Parent movement that triggered this child movement via BOM explosion',
  },

  childMovements: {
    id: toFieldId('childMovements'),
    key: 'childMovements',
    label: 'Child Movements',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'stock_movement_child_movements',
    systemSortOrder: 'a9',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationshipConfig: {
      relatedEntityType: 'stock_movement',
      relationshipType: 'has_many',
      inverseName: 'Parent Movement',
      inverseSystemAttribute: 'stock_movement_parent_movement',
    },
    description: 'Child movements created by BOM explosion from this parent movement',
  },

  // ─── Receiving: cost, date and provenance ─────────────────────────
  // plans/purchasing/01-build-plan.md §2.1. All `creatable: true` /
  // `updatable: false`, like every other field on this entity.

  unitCost: {
    id: toFieldId('unitCost'),
    key: 'unitCost',
    label: 'Unit Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'stock_movement_unit_cost',
    systemSortOrder: 'b0',
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
      updatable: false,
      configurable: false,
    },
    description:
      'Cost per unit, FROZEN at write time, integer minor units. Never recomputed - a March ' +
      'vendor-price change must not restate January.',
  },

  extendedCost: {
    id: toFieldId('extendedCost'),
    key: 'extendedCost',
    label: 'Extended Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'stock_movement_extended_cost',
    systemSortOrder: 'b1',
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
      updatable: false,
      configurable: false,
    },
    description:
      'round(unitCost x quantity), SIGNED like quantity so SUM(extendedCost) GROUP BY glAccount ' +
      'is the account balance without a per-row case expression',
  },

  costBasis: {
    id: toFieldId('costBasis'),
    key: 'costBasis',
    label: 'Cost Basis',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'stock_movement_cost_basis',
    systemSortOrder: 'b2',
    nullable: true,
    options: { options: StockMovementCostBasis.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    placeholder: 'Select cost basis',
    description:
      'How this row was valued. A build values at `standard`; a receipt is the first thing in ' +
      'the system that legitimately writes `actual`, and the difference between the two is PPV.',
  },

  glAccount: {
    id: toFieldId('glAccount'),
    key: 'glAccount',
    label: 'GL Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'stock_movement_gl_account',
    systemSortOrder: 'b3',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description:
      'Account CODE (1310 / 1320 / 1330), resolved from the part kind at write time. A code, ' +
      'never an accounting provider id - the provider is an exporter, not the system of record.',
  },

  occurredAt: {
    id: toFieldId('occurredAt'),
    key: 'occurredAt',
    label: 'Occurred',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'stock_movement_occurred_at',
    systemSortOrder: 'b4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    placeholder: 'Select date',
    description:
      'The ACCOUNTING date, on every movement type. `createdAt` records when the row was typed ' +
      'and cannot be set - the pallet lands Thursday and the paperwork is keyed Monday, so ' +
      'without this every period boundary falls on the wrong side.',
  },

  vendorPart: {
    id: toFieldId('vendorPart'),
    key: 'vendorPart',
    label: 'Supplier Price',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'stock_movement_vendor_part',
    systemSortOrder: 'b5',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_part:stockMovements' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_part',
      relationshipType: 'belongs_to',
      inverseName: 'Stock Movements',
      inverseSystemAttribute: 'vendor_part_stock_movements',
    },
    description:
      'Which supplier row priced this receipt. NULL on every non-receipt type. Incidentally the ' +
      'first time the system can answer what we have actually bought from a supplier.',
  },

  vendorUnitPrice: {
    id: toFieldId('vendorUnitPrice'),
    key: 'vendorUnitPrice',
    label: 'Vendor Unit Price',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'stock_movement_vendor_unit_price',
    systemSortOrder: 'b6',
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
      updatable: false,
      configurable: false,
    },
    description:
      'The RAW invoice price per unit, before freight and tariff. Frozen. Kept beside unitCost ' +
      'because the landed total alone cannot say whether the motor got more expensive or the ' +
      'freight did - and it is what GRNI clears against, since the vendor bills only this part.',
  },

  purchaseOrderLine: {
    id: toFieldId('purchaseOrderLine'),
    key: 'purchaseOrderLine',
    label: 'Purchase Order Line',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'stock_movement_purchase_order_line',
    systemSortOrder: 'b7',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'purchase_order_line:stockMovements' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'purchase_order_line',
      relationshipType: 'belongs_to',
      inverseName: 'Stock Movements',
      inverseSystemAttribute: 'purchase_order_line_stock_movements',
    },
    description:
      'The ordered line this receipt satisfies - one half of three-way match. Declared with the ' +
      'other receiving fields; `linkNewRelationships` links it once the counterpart def exists.',
  },

  reversesMovement: {
    id: toFieldId('reversesMovement'),
    key: 'reversesMovement',
    label: 'Reverses Movement',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'stock_movement_reverses_movement',
    systemSortOrder: 'b8',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    relationshipConfig: {
      relatedEntityType: 'stock_movement',
      relationshipType: 'belongs_to',
      inverseName: 'Reversed By',
      inverseSystemAttribute: 'stock_movement_reversed_by_movements',
    },
    description:
      'The movement this row undoes - a vendor return or a keying correction, valued at the ' +
      'ORIGINAL frozen cost. Deliberately NOT `parentMovement`: that means parent of a BOM ' +
      'explosion and `explodeBomMovement` reads it, so overloading it would push reversal rows ' +
      'into `childMovements` and corrupt the explosion bookkeeping.',
  },

  reversedByMovements: {
    id: toFieldId('reversedByMovements'),
    key: 'reversedByMovements',
    label: 'Reversed By',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'stock_movement_reversed_by_movements',
    systemSortOrder: 'b9',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationshipConfig: {
      relatedEntityType: 'stock_movement',
      relationshipType: 'has_many',
      inverseName: 'Reverses Movement',
      inverseSystemAttribute: 'stock_movement_reverses_movement',
    },
    description: 'Rows that undo this movement',
  },

  createdBy: CREATED_BY_FIELD,
}
