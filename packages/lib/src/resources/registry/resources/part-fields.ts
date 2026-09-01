// packages/lib/src/resources/registry/resources/part-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { LINE_ITEM_UNIT_OPTIONS } from '../../../money/units'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { CostSource, PartKind, StockStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Part resource
 */
export const PART_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique part identifier',
  },

  title: {
    id: toFieldId('title'),
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'part_title',
    systemSortOrder: 'a1',
    dbColumn: 'title',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Enter part title',
  },

  sku: {
    id: toFieldId('sku'),
    key: 'sku',
    label: 'SKU',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'part_sku',
    systemSortOrder: 'a2',
    dbColumn: 'sku',
    nullable: false,
    isIdentifier: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      unique: true,
      configurable: false,
    },
    placeholder: 'Enter SKU',
    description: 'Stock Keeping Unit - must be unique',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'part_description',
    systemSortOrder: 'a3',
    dbColumn: 'description',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter description',
  },

  image: {
    id: toFieldId('image'),
    key: 'image',
    label: 'Image',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'part_image',
    systemSortOrder: 'a3a',
    nullable: true,
    options: {
      file: { allowMultiple: false, maxFiles: 1, allowedFileTypes: ['image'] },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Product image used as the part avatar',
  },

  // Category is an inline TAGS field (option-backed, free-form multi-value —
  // NOT the global Tag entity). Slug stays `category`; values live in
  // FieldValue.optionId. Options grow dynamically as users add categories.
  category: {
    id: toFieldId('category'),
    key: 'category',
    label: 'Category',
    type: BaseType.TAGS,
    fieldType: FieldType.TAGS,
    isSystem: true,
    systemAttribute: 'category',
    systemSortOrder: 'a4',
    nullable: true,
    options: { options: [] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Add categories',
    description: 'Category tags for this part',
  },

  // ── Cost provenance ────────────────────────────────────────────────
  // `part_cost` is one output with two meanings; these three name them, so a
  // NULL carries information instead of being indistinguishable from a frozen
  // value. All three are written ONLY by `persistCosts` (bom/cost-calculator.ts)
  // and locked `computed` so no form, import or connector can become a second
  // writer. None carries `dbColumn` — `cost`'s is a leftover from the pre-entity
  // `Part` table, not a pattern to copy.

  purchaseCost: {
    id: toFieldId('purchaseCost'),
    key: 'purchaseCost',
    label: 'Purchase Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'part_purchase_cost',
    systemSortOrder: 'a5b',
    showInTable: false, // diagnostic — `part_cost` stays the headline column in the parts list
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
      'Landed cost of the winning vendor part, including shipping, tariff and other costs',
  },

  rollupCost: {
    id: toFieldId('rollupCost'),
    key: 'rollupCost',
    label: 'Roll-up Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'part_rollup_cost',
    systemSortOrder: 'a5c',
    showInTable: false, // diagnostic — `part_cost` stays the headline column in the parts list
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
      'Sum of each subpart cost multiplied by its quantity. Recorded even when a supplier price wins, so buy-vs-build is comparable',
  },

  costSource: {
    id: toFieldId('costSource'),
    key: 'costSource',
    label: 'Cost Source',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'part_cost_source',
    systemSortOrder: 'a5d',
    showInTable: false, // diagnostic — `part_cost` stays the headline column in the parts list
    nullable: true,
    options: { options: CostSource.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description: 'Which number Cost took: the supplier price, the bill of materials, or neither',
  },

  cost: {
    id: toFieldId('cost'),
    key: 'cost',
    label: 'Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'part_cost',
    systemSortOrder: 'a6',
    dbColumn: 'cost',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Replacement cost — current landed cost from live vendor prices',
  },

  hsCode: {
    id: toFieldId('hsCode'),
    key: 'hsCode',
    label: 'HS Code',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'hs_code',
    systemSortOrder: 'a5',
    dbColumn: 'hsCode',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter HS code',
    description: 'Harmonized System code for customs',
  },

  /**
   * The part's stock unit of measure — the unit EVERY quantity in the inventory
   * chain is already denominated in, finally named.
   *
   * 🛑 It lives on the part, not on the line, and that is the whole design.
   * `part_quantity_on_hand`, `stock_movement_quantity`, `subpart` BOM quantities,
   * `purchase_order_line_quantity_ordered` and `_quantity_received` are all bare
   * numbers that only reconcile because they share one implied unit. Putting a
   * unit on the purchasing LINE instead (the `line_item` shape) would let a line
   * be ordered in `box` and received in `ea`, and the received-vs-ordered roll-up
   * — the thing the three-way match is built on — would silently compare two
   * different units. A per-vendor pack size belongs on `vendor_part` with a real
   * conversion factor, and is a separate feature.
   *
   * Purchasing rows render it read-only beside the quantity: a PO does not get to
   * choose the unit its part is stocked in.
   *
   * Nullable with no backfill — an unset unit reads as unitless and displays a
   * bare number, which is exactly today's behaviour for every existing part.
   */
  unit: {
    id: toFieldId('unit'),
    key: 'unit',
    label: 'Unit',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'part_unit',
    systemSortOrder: 'a4',
    nullable: true,
    options: { options: [...LINE_ITEM_UNIT_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select unit',
    defaultValue: 'each',
    description: 'Stock unit of measure — every quantity recorded for this part is in this unit',
  },

  // Ships the FIELD only. `readPartKind` / `shouldExplodeOnSale` and the
  // `adjustSubparts` change that consume it belong to Gap C and land with their
  // consumer; an absent value reads NULL and every reader must treat NULL as
  // `component`, preserving today's explode-on-sale behaviour for every
  // unclassified part. No backfill.
  //
  // `defaultValue: 'component'` (15-costing-usability.md §4c) makes the common
  // case the preselected one instead of an empty select nobody fills in. It is
  // the SINGLE source of that default: the create dialog seeds its state from
  // this field rather than from a literal, and `applyDefaults` covers the doors
  // that send no key at all (import, API, connectors, seed). Reachable for
  // existing orgs because `mergeSystemAndCustomFields` resolves
  // `dbField.defaultValue ?? staticField.defaultValue`, and `part_kind` is NULL
  // on every stored field row, exactly like `build_status` and its 'planned'.
  //
  // 🛑 It also changes what a stored `component` MEANS: it no longer proves a
  // human typed it. `shouldSuggestFinishedGood` (part-family-suggestion.ts) was
  // widened in the same change to fire on `component` as well as unset, because
  // the unset-only gate was the only safety net against a finished good being
  // posted to 1310 instead of 1330 and frozen on `updatable: false` movements.
  partKind: {
    id: toFieldId('partKind'),
    key: 'partKind',
    label: 'Part Kind',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'part_kind',
    systemSortOrder: 'a4a',
    nullable: true,
    options: { options: PartKind.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select part kind',
    defaultValue: PartKind.COMPONENT,
    description:
      'How this part is classified for build and sell purposes. Unset reads as a component',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a7',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when part is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'a8',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when part is modified',
  },

  quantityOnHand: {
    id: toFieldId('quantityOnHand'),
    key: 'quantityOnHand',
    label: 'Qty on Hand',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'part_quantity_on_hand',
    systemSortOrder: 'a6a',
    showInPanel: false, // shown in the drawer's stock section, not as a panel field row
    showInTable: true, // but useful as a default column in the parts list
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description: 'Calculated from stock movements',
  },

  stockStatus: {
    id: toFieldId('stockStatus'),
    key: 'stockStatus',
    label: 'Stock Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'part_stock_status',
    systemSortOrder: 'a6b',
    showInPanel: false, // shown in the drawer's stock section, not as a panel field row
    showInTable: true, // but useful as a default column in the parts list
    nullable: true,
    options: { options: StockStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description: 'Derived from quantity on hand and reorder point',
  },

  reorderPoint: {
    id: toFieldId('reorderPoint'),
    key: 'reorderPoint',
    label: 'Reorder Point',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'part_reorder_point',
    systemSortOrder: 'a6c',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter reorder point',
    description: 'Minimum quantity before reorder is needed',
  },

  reorderQty: {
    id: toFieldId('reorderQty'),
    key: 'reorderQty',
    label: 'Reorder Qty',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'part_reorder_qty',
    systemSortOrder: 'a6d',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter reorder quantity',
    description: 'Quantity to reorder when stock is low',
  },

  // Reverse relationship: stockMovements (one-to-many from stock_movement.part)
  stockMovements: {
    id: toFieldId('stockMovements'),
    key: 'stockMovements',
    label: 'Stock Movements',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'part_stock_movements',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'stock_movement:part' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Stock movements for this part',
  },

  // Reverse relationship: vendorParts (one-to-many from vendor_part.part)
  vendorParts: {
    id: toFieldId('vendorParts'),
    key: 'vendorParts',
    // Relabelled from 'Vendor Parts': the join entity's NAME is the thing being
    // kept off-stage, and a field label is where it leaked (02-design §6.2). The
    // drawer already said "Suppliers" rather than "Vendor Parts".
    label: 'Supplier Pricing',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'part_vendor_parts',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_part:part' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    // `vendor_part` is hidden, so it has no records page to host an Import button.
    // This is that button. Target def comes from `inverseResourceFieldId` above.
    namedImporter: { label: 'Import supplier prices' },
    description: 'Supplier prices linked to this part',
  },

  // Reverse relationship: subparts (one-to-many from subpart.parentPart)
  subparts: {
    id: toFieldId('subparts'),
    key: 'subparts',
    label: 'Components',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'part_subparts',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'subpart:parentPart' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    namedImporter: { label: 'Import BOM' },
    description: 'Child parts used in this assembly',
  },

  // Reverse relationship: usedInAssemblies (one-to-many from subpart.childPart)
  usedInAssemblies: {
    id: toFieldId('usedInAssemblies'),
    key: 'usedInAssemblies',
    label: 'Used In',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'part_used_in_assemblies',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'subpart:childPart' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    // 🛑 No `namedImporter`, deliberately (02-design §6.4, O3). This is the same
    // BOM edge as `subparts` read backwards. Offering both would let one file
    // assert one edge in two senses, and the `(parentPart, childPart)` key
    // collapses those to whichever row landed last — a silently wrong quantity.
    description: 'Assemblies that use this part as a component',
  },

  // Reverse relationship: catalogItems (one-to-many from catalog_item.part)
  catalogItems: {
    id: toFieldId('catalogItems'),
    key: 'catalogItems',
    label: 'Catalog Items',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'part_catalog_items',
    systemSortOrder: 'a9',
    showInPanel: false, // parts drawer doesn't need it v1
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'catalog_item:part' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Catalog (product/service) entries backed by this part',
  },

  // Reverse relationship: lineItems (one-to-many from line_item.part). The
  // counterpart of the STAMPED `line_item_part`
  // (plans/products/08-order-build.md §6.2) — this is what makes revenue by
  // part a single join instead of the three-hop
  // line -> catalog_item -> part -> product chain.
  lineItems: {
    id: toFieldId('lineItems'),
    key: 'lineItems',
    label: 'Line Items',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'part_line_items',
    systemSortOrder: 'a9b',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'line_item:part' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Sold lines stamped with this part',
  },

  // Optional place in a product family (plans/products/01-product-family.md §5).
  // The only family edge: connectors and humans write the same relation.
  product: {
    id: toFieldId('product'),
    key: 'product',
    label: 'Product',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'part_product',
    systemSortOrder: 'a9a',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'product:parts' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'product',
      relationshipType: 'belongs_to',
      inverseName: 'Parts',
      inverseSystemAttribute: 'product_parts',
    },
    placeholder: 'Select product',
    description: 'The product family this part belongs to',
  },

  // Reverse relationship: purchaseOrderLines (from purchase_order_line.part)
  purchaseOrderLines: {
    id: toFieldId('purchaseOrderLines'),
    key: 'purchaseOrderLines',
    label: 'Purchase Order Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'part_purchase_order_lines',
    showInPanel: false,
    systemSortOrder: 'c0',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'purchase_order_line:part' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description:
      'Purchase order lines ordering this part - the on-order quantity reads through here',
  },

  // Reverse relationship: vendorBillLines (from vendor_bill_line.part)
  vendorBillLines: {
    id: toFieldId('vendorBillLines'),
    key: 'vendorBillLines',
    label: 'Vendor Bill Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'part_vendor_bill_lines',
    showInPanel: false,
    systemSortOrder: 'c1',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_bill_line:part' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Bill lines charging for this part - what we were actually invoiced, per part',
  },

  // ─── Standard cost — the FROZEN half of the two costs a part carries ──
  // plans/products/build/01-build-plan.md §1.2, §2.4. Entity migration 109.
  //
  // `part_cost` answers "what would this cost to build today" and is rewritten
  // by `recalculateAffectedParts` on every vendor-price or BOM change, silently
  // and constantly. These answer "what we have agreed to value it at": written
  // ONLY by `rollStandardCost`, only when a person runs it, with a stamped
  // effective date. `part_standard_cost` is what every stock movement stamps —
  // if it were recalculated automatically it would just BE `part_cost`, and
  // every frozen unitCost would drift with vendor prices, which is the defect
  // this whole subsystem exists to avoid.
  //
  // The three components are split because it is load-bearing, not for tidiness:
  // the fulfillment COGS entry has to land across 5000 Materials / 5010 Direct
  // Labor / 5020 Applied Overhead, and it can only do that if the finished
  // good's standard remembers its composition.
  //
  // ⚠️ All five are hidden from the Details panel and the dialogs (§1.6). Five
  // read-only cost rows would swamp the panel; they surface on the part drawer's
  // Costing card, which already renders exactly this shape. Nobody types them.
  // Deliberately NOT `capabilities.hidden` — they stay findable in the field
  // picker, filterable, and addable to a view by anyone who wants them.

  standardMaterialCost: {
    id: toFieldId('standardMaterialCost'),
    key: 'standardMaterialCost',
    label: 'Standard Material Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'part_standard_material_cost',
    systemSortOrder: 'a5e',
    nullable: true,
    showInPanel: false,
    showInDialogs: false,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'Frozen material roll-up, integer minor units. For a built part this is the sum of its ' +
      "children's standardCost x quantity — NOT round(part_cost), which is a pure material " +
      'chain and drops every subassembly conversion cost on the way up (README B11)',
  },

  standardLaborCost: {
    id: toFieldId('standardLaborCost'),
    key: 'standardLaborCost',
    label: 'Standard Labor Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'part_standard_labor_cost',
    systemSortOrder: 'a5f',
    nullable: true,
    showInPanel: false,
    showInDialogs: false,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'Absorbed direct labour per unit, integer minor units. Applies ONLY to a subassembly or ' +
      'finished_good — a purchased component gets 0, because we did not assemble it and ' +
      'capitalising labour never spent would overstate 1310 Raw Materials (README B11)',
  },

  standardOverheadCost: {
    id: toFieldId('standardOverheadCost'),
    key: 'standardOverheadCost',
    label: 'Standard Overhead Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'part_standard_overhead_cost',
    systemSortOrder: 'a5g',
    nullable: true,
    showInPanel: false,
    showInDialogs: false,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'Applied overhead per unit, integer minor units. Gated on partKind exactly as ' +
      'standardLaborCost is',
  },

  standardCost: {
    id: toFieldId('standardCost'),
    key: 'standardCost',
    label: 'Standard Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'part_standard_cost',
    systemSortOrder: 'a5h',
    nullable: true,
    showInPanel: false,
    showInDialogs: false,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'Material + labour + overhead, integer minor units — THE value every stock movement ' +
      'stamps. Rounded before freezing: computeLandedCost can emit a fractional-cent tariff ' +
      'term, and an unrounded standard makes every downstream balance check hold by luck',
  },

  standardCostEffectiveAt: {
    id: toFieldId('standardCostEffectiveAt'),
    key: 'standardCostEffectiveAt',
    label: 'Standard Cost Effective',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'part_standard_cost_effective_at',
    systemSortOrder: 'a5i',
    nullable: true,
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'When the current standard took effect. Stamped by rollStandardCost — the delta ' +
      'between part_cost and part_standard_cost since this date is what tells you a roll is due',
  },

  // ─── Per-part absorption overrides (plans/money/tasks/22) ───────────
  //
  // The INPUTS whose output is the frozen `part_standard_labor_cost` /
  // `part_standard_overhead_cost` block above — the same relationship
  // `part_cost` has to `part_standard_cost`: one is live and editable, the
  // other is what was agreed and only `rollStandardCost` writes it.
  //
  // Without these, `standard-cost-roll.ts` reads ONE org-wide rate for every
  // built part at every level of every bill of materials, so a finished good
  // assembled from 8 subassemblies carries 9 x the flat rate whether or not
  // that describes the work. A NULL here means "use the org rate"; a stored 0
  // means "absorb nothing" and is how a subassembly is made cost-transparent.
  //
  // 🛑 `creatable` / `updatable` are TRUE and `computed` is absent — unlike
  // every `part_standard_*` field. That is deliberate and it is what makes
  // them settable by the importer: `getImportableFields` filters on
  // `creatable && !hidden && !relationship` and never reads `updatable`, while
  // the CRUD layer enforces `updatable` on the write. Both are needed — one to
  // be offered a column, one so a second update pass can revise it.
  //
  // ⚠️ `showInPanel: false` is a DEFAULT, not a lock (`resolveFieldVisible`
  // lets an explicit org choice win) and it does NOT affect import. They are
  // hidden because 82% of parts are components, where both fields are inert;
  // the part drawer's Costing card renders them gated on `part_kind`, next to
  // the frozen composition they produce.

  laborCostPerUnit: {
    id: toFieldId('laborCostPerUnit'),
    key: 'laborCostPerUnit',
    label: 'Labor Cost Per Unit',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'part_labor_cost_per_unit',
    systemSortOrder: 'a5j',
    nullable: true,
    showInPanel: false,
    // Explicit, because an unset `showInTable` resolves to `showInPanel !== false`
    // — omitting both would add two mostly-empty columns to every parts list.
    showInTable: false,
    showInDialogs: false,
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
      'Absorbed direct labour per assembled unit for THIS part, integer minor units. Overrides ' +
      'manufacturing.assemblyLaborCostPerUnit. Empty = use the org rate; 0 = absorb nothing. ' +
      'Ignored on a component, which never absorbs conversion cost (README B11). On re-import a ' +
      'blank cell LEAVES the stored value alone — clearing one needs mergeStrategy: overwrite',
  },

  overheadCostPerUnit: {
    id: toFieldId('overheadCostPerUnit'),
    key: 'overheadCostPerUnit',
    label: 'Overhead Cost Per Unit',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'part_overhead_cost_per_unit',
    systemSortOrder: 'a5k',
    nullable: true,
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
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
      'Applied overhead per assembled unit for THIS part, integer minor units. Overrides ' +
      'manufacturing.overheadCostPerUnit. Gated on partKind exactly as laborCostPerUnit is',
  },

  // Reverse relationship: builds (from build.part)
  builds: {
    id: toFieldId('builds'),
    key: 'builds',
    label: 'Builds',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'part_builds',
    systemSortOrder: 'c2',
    showInPanel: false, // has_many inverse; a tab lists them
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'build:part' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Builds that produce this part',
  },

  createdBy: CREATED_BY_FIELD,
}
