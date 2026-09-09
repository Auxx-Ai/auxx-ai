// packages/lib/src/resources/registry/resources/line-item-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { RATE_DECIMALS } from '@auxx/utils/currency'
import { LINE_ITEM_UNIT_OPTIONS } from '../../../money/units'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'
import { CATALOG_CATEGORY_OPTIONS } from './catalog-item-fields'

/**
 * Field definitions for the Line Item resource — quote/work-order/invoice line rows
 * (money module, README). Hidden system entity — rendered only by the embedded
 * line-builder UIs (§H.1), never shown in the entity sidebar or generic dialogs.
 */
export const LINE_ITEM_FIELDS: Record<string, ResourceField> = {
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

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'line_item_name',
    systemSortOrder: 'a1',
    // Optional — the line builder creates EMPTY lines that the catalog picker
    // fills in afterwards.
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter line name',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'line_item_description',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter description',
  },

  qty: {
    id: toFieldId('qty'),
    key: 'qty',
    label: 'Qty',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'line_item_qty',
    systemSortOrder: 'a3',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: 1,
  },

  unit: {
    id: toFieldId('unit'),
    key: 'unit',
    label: 'Unit',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'line_item_unit',
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
  },

  unitPrice: {
    id: toFieldId('unitPrice'),
    key: 'unitPrice',
    label: 'Unit Price',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'line_item_unit_price',
    systemSortOrder: 'a5',
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
  },

  lineTotal: {
    id: toFieldId('lineTotal'),
    key: 'lineTotal',
    label: 'Line Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'line_item_line_total',
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
      creatable: false, // totals engine (§F) is the only writer
      updatable: false,
      configurable: false,
    },
  },

  taxable: {
    id: toFieldId('taxable'),
    key: 'taxable',
    label: 'Taxable',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'line_item_taxable',
    systemSortOrder: 'a7',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: true,
  },

  // The provider's per-line tax, as ONE number
  // (plans/money/tasks/48-shopify-tax-data.md §4.2). Deliberately asymmetric
  // with the order side, which fans `tax_lines[]` out into `tax_line` records:
  // per-line-per-jurisdiction detail answers no question anybody has, because
  // filing needs the breakdown per ORDER and the fulfillment builder needs one
  // number per LINE. Fanning it out too would multiply roughly 63k records over
  // the full order history to serve nothing.
  //
  // ✅ This is what lets `buildFulfillmentEntry` populate its per-line
  // `taxMinor` and REPLACE the pro-rata approximation with exact figures on
  // split shipments. It accepts a per-line tax today and never receives one, so
  // it always falls back to allocating the order total across shipments
  // (`build-fulfillment-entry.ts:180`, `:214`).
  //
  // 🛑 No default. 48 §8.2: "not supplied" and "supplied as zero" are different
  // states - a null FieldValue against a row holding 0 - and both post nothing,
  // which is exactly why they get collapsed if nobody writes it down. Defaulting
  // this to 0 would tell the ledger the provider said there was no tax, when in
  // fact it said nothing at all.
  taxTotal: {
    id: toFieldId('taxTotal'),
    key: 'taxTotal',
    label: 'Tax Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'line_item_tax_total',
    systemSortOrder: 'a7a',
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
      'Integer minor units. The tax the provider computed for THIS line, carried and never ' +
      'derived. Null means no tax figure was supplied for the line, which is not the same ' +
      'as a supplied zero',
  },

  // Reverse relationship: the refund lines that sent part of this line back
  // (plans/money/tasks/47-shopify-refunds.md §2.2). The counterpart of the
  // owning `refund_line_line_item`, and declared for the same reason
  // `part_line_items` is: an inverse a relationship POINTS AT but that does not
  // exist leaves the edge unlinked, and an unlinked relationship accepts writes
  // while this side reads empty (the trap entity migration 135 asserts against).
  refundLines: {
    id: toFieldId('refundLines'),
    key: 'refundLines',
    label: 'Refund Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'line_item_refund_lines',
    systemSortOrder: 'a7b',
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'refund_line:lineItem' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    },
    description: 'Refund lines that returned or cancelled part of this line',
  },

  optional: {
    id: toFieldId('optional'),
    key: 'optional',
    label: 'Optional',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'line_item_optional',
    systemSortOrder: 'a8',
    showInPanel: false, // builder-only UI
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: false,
  },

  optionalSelected: {
    id: toFieldId('optionalSelected'),
    key: 'optionalSelected',
    label: 'Optional Selected',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'line_item_optional_selected',
    systemSortOrder: 'a9',
    showInPanel: false, // builder-only UI
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: true,
  },

  category: {
    id: toFieldId('category'),
    key: 'category',
    label: 'Category',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'line_item_category',
    systemSortOrder: 'aA',
    nullable: true,
    options: { options: [...CATALOG_CATEGORY_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select category',
  },

  discount: {
    id: toFieldId('discount'),
    key: 'discount',
    label: 'Discount',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'line_item_discount',
    systemSortOrder: 'aB',
    showInPanel: false, // line-level discount is a later UI unlock (README); field ships now
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  sortOrder: {
    id: toFieldId('sortOrder'),
    key: 'sortOrder',
    label: 'Sort Order',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'line_item_sort_order',
    systemSortOrder: 'aC',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  visitId: {
    id: toFieldId('visitId'),
    key: 'visitId',
    label: 'Visit ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'line_item_visit_id',
    systemSortOrder: 'aD',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  sourceLine: {
    id: toFieldId('sourceLine'),
    key: 'sourceLine',
    label: 'Source Line',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'line_item_source_line',
    systemSortOrder: 'aD1',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  catalogItem: {
    id: toFieldId('catalogItem'),
    key: 'catalogItem',
    label: 'Catalog Item',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'line_item_catalog_item',
    systemSortOrder: 'aE',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'catalog_item:lineItems' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'catalog_item',
      relationshipType: 'belongs_to',
      inverseName: 'Line Items',
      inverseSystemAttribute: 'catalog_item_line_items',
    },
  },

  quote: {
    id: toFieldId('quote'),
    key: 'quote',
    label: 'Quote',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'line_item_quote',
    systemSortOrder: 'aF',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'quote:lineItems' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'quote',
      relationshipType: 'belongs_to',
      inverseName: 'Line Items',
      inverseSystemAttribute: 'quote_line_items',
    },
  },

  workOrder: {
    id: toFieldId('workOrder'),
    key: 'workOrder',
    label: 'Work Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'line_item_work_order',
    systemSortOrder: 'b0',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'work_order:lineItems' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'work_order',
      relationshipType: 'belongs_to',
      inverseName: 'Line Items',
      inverseSystemAttribute: 'work_order_line_items',
    },
  },

  invoice: {
    id: toFieldId('invoice'),
    key: 'invoice',
    label: 'Invoice',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'line_item_invoice',
    systemSortOrder: 'b1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'invoice:lineItems' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'invoice',
      relationshipType: 'belongs_to',
      inverseName: 'Line Items',
      inverseSystemAttribute: 'invoice_line_items',
    },
  },

  // The fourth document slot (plans/products/08-order-build.md §2). Sort keys
  // `b10`/`b11` sit between `invoice` (`b1`) and `photos` (`b1a`) so the four
  // document relations stay adjacent in the panel.
  order: {
    id: toFieldId('order'),
    key: 'order',
    label: 'Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'line_item_order',
    systemSortOrder: 'b10',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'order:lineItems' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'order',
      relationshipType: 'belongs_to',
      inverseName: 'Line Items',
      inverseSystemAttribute: 'order_line_items',
    },
  },

  part: {
    id: toFieldId('part'),
    key: 'part',
    label: 'Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'line_item_part',
    systemSortOrder: 'b11',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'part:lineItems' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'part',
      relationshipType: 'belongs_to',
      inverseName: 'Line Items',
      inverseSystemAttribute: 'part_line_items',
    },
  },

  photos: {
    id: toFieldId('photos'),
    key: 'photos',
    label: 'Photos',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'line_item_photos',
    systemSortOrder: 'b1a',
    nullable: true,
    options: {
      file: { allowMultiple: true, allowedFileTypes: ['image'], maxFiles: 10 },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
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
    systemSortOrder: 'b2',
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
    systemSortOrder: 'b3',
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
