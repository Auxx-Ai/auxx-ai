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
  },

  /**
   * The inventory account this movement belongs to, stored as an auxx **ROLE**
   * (`inventory_raw_materials` / `inventory_finished_goods`) — never an account
   * code and never a provider id.
   *
   * 🛑 The field is named `glAccount` and its system attribute reads
   * `stock_movement_gl_account`; both predate decision `G8` and neither can be
   * renamed without reshaping a materialised field in every org. The VALUE is a
   * role. Read it as one.
   *
   * **Why a role and not `'1310'`.** `P2` keeps the provider's account ids out
   * of the ledger. `G8` is the same argument one level up: `G7` makes the chart
   * of accounts a seeded default the org **edits**, so the account NUMBER
   * cannot carry the meaning either. This row is append-only and its cost is
   * frozen at write time (`updatable: false` on every field here) — a number
   * stamped on it in 2026 is silently reinterpreted the day someone renumbers
   * Raw Materials, and the resulting posting still balances, so nothing
   * downstream can detect it. A role survives the renumber; the resolution
   * chain `role -> the org's gl_account -> code -> provider id` re-derives the
   * number at posting time.
   *
   * `resolveInventoryRoleForPartKind` (receiving/client.ts) is the only thing
   * that decides this value; `receiveStock`, `adjustStock` and `completeBuild`
   * stamp it, the two reversal paths copy it verbatim, and `buildReceiptEntry`
   * consumes it as `inventoryAccountRole`.
   *
   * `inventory_wip` is never written here: nothing in the `partKind` table maps
   * to it, and neither receiving nor a completed build produces work in process.
   */
  glAccount: {
    id: toFieldId('glAccount'),
    key: 'glAccount',
    // ⚠️ NOT relabelled to match the value. `mergeSystemAndCustomFields` takes
    // `label` from `CustomField.name`, never from the registry, so a rename here
    // would reach fresh orgs only and leave 28 existing ones reading the old
    // one — the exact half-present split this file's comments exist to prevent.
    // The field is `showInPanel: false` and rendered with its own label by the
    // one card that shows it, so the label is not the load-bearing part.
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
      'Which auxx posting role the inventory side of this movement belongs to. A ROLE, not an account number: the chart of accounts is editable, and a number frozen onto an append-only ledger row would be silently reinterpreted by a renumber.',
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
  },

  // ─── Build provenance and the as-built BOM snapshot ────────────────
  // plans/products/build/01-build-plan.md §1.2. Entity migration 109, inert:
  // `packages/lib/src/builds/` does not exist yet, so both read NULL on every
  // existing row and there is no backfill.

  build: {
    id: toFieldId('build'),
    key: 'build',
    label: 'Build',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'stock_movement_build',
    systemSortOrder: 'c0',
    nullable: true,
    // Provenance read by the ledger UI, not a row a person fills in.
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'build:movements' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'build',
      relationshipType: 'belongs_to',
      inverseName: 'Stock Movements',
      inverseSystemAttribute: 'build_movements',
    },
  },

  qtyPerUnit: {
    id: toFieldId('qtyPerUnit'),
    key: 'qtyPerUnit',
    label: 'Qty Per Unit',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'stock_movement_qty_per_unit',
    systemSortOrder: 'c1',
    nullable: true,
    // A diagnostic for the usage cross-check. Exposing it invites someone to
    // "correct" the as-built snapshot, which destroys its only purpose.
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
  },

  createdBy: CREATED_BY_FIELD,
}
