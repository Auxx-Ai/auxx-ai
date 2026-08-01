// packages/lib/src/resources/registry/resources/catalog-item-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { LINE_ITEM_UNIT_OPTIONS } from '../../../money/units'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Shared with LINE_ITEM_FIELDS.category — define here, import there.
 * Org-extendable (01-ui #6) — these are the seeded defaults, not a closed set.
 */
export const CATALOG_CATEGORY_OPTIONS = [
  { label: 'Service', value: 'service', color: 'blue' },
  { label: 'Material', value: 'material', color: 'orange' },
  { label: 'Labor', value: 'labor', color: 'green' },
] as const

/**
 * Field definitions for the Catalog Item resource (Products & Services, README/01-ui #6).
 * Hidden system entity — managed from dispatch settings, never shown in the entity sidebar.
 */
export const CATALOG_ITEM_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique catalog item identifier',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'catalog_item_name',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Enter item name',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'catalog_item_description',
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

  category: {
    id: toFieldId('category'),
    key: 'category',
    label: 'Category',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'catalog_item_category',
    systemSortOrder: 'a3',
    nullable: false,
    options: { options: [...CATALOG_CATEGORY_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select category',
    defaultValue: 'service',
  },

  defaultUnitPrice: {
    id: toFieldId('defaultUnitPrice'),
    key: 'defaultUnitPrice',
    label: 'Default Unit Price',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'catalog_item_default_unit_price',
    systemSortOrder: 'a4',
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
    placeholder: 'Enter default price',
  },

  defaultUnit: {
    id: toFieldId('defaultUnit'),
    key: 'defaultUnit',
    label: 'Default Unit',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'catalog_item_default_unit',
    systemSortOrder: 'a5',
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

  taxable: {
    id: toFieldId('taxable'),
    key: 'taxable',
    label: 'Taxable',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'catalog_item_taxable',
    systemSortOrder: 'a6',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: true,
    description: 'Copied onto lines when this item is picked',
  },

  active: {
    id: toFieldId('active'),
    key: 'active',
    label: 'Active',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'catalog_item_active',
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
    description: 'Inactive items are hidden from the picker but keep historical lines',
  },

  part: {
    id: toFieldId('part'),
    key: 'part',
    label: 'Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'catalog_item_part',
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'part:catalogItems' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'part',
      relationshipType: 'belongs_to',
      inverseName: 'Catalog Items',
      inverseSystemAttribute: 'part_catalog_items',
    },
    description: 'Inventory part backing this catalog entry (material items)',
  },

  cost: {
    id: toFieldId('cost'),
    key: 'cost',
    label: 'Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'catalog_item_cost',
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
      creatable: false, // the pricing sync engine is the only writer
      updatable: false,
      configurable: false,
    },
    description: "Synced from the linked part's calculated cost",
  },

  markup: {
    id: toFieldId('markup'),
    key: 'markup',
    label: 'Markup (%)',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'catalog_item_markup',
    systemSortOrder: 'aA',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Markup percentage',
    description: 'Markup rate as a percentage of cost — null pauses auto-pricing',
  },

  lineItems: {
    id: toFieldId('lineItems'),
    key: 'lineItems',
    label: 'Line Items',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'catalog_item_line_items',
    systemSortOrder: 'aB',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'line_item:catalogItem' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Lines that were picked from this catalog item',
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
    description: 'Automatically set when the catalog item is created',
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
    description: 'Automatically updated when the catalog item is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
