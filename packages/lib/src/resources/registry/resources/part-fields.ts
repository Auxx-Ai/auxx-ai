// packages/lib/src/resources/registry/resources/part-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
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

  // Ships the FIELD only. `readPartKind` / `shouldExplodeOnSale` and the
  // `adjustSubparts` change that consume it belong to Gap C and land with their
  // consumer; an absent value reads NULL and every reader must treat NULL as
  // `component`, preserving today's explode-on-sale behaviour for every
  // unclassified part. No backfill.
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

  createdBy: CREATED_BY_FIELD,
}
