// packages/lib/src/resources/registry/resources/part-fields.ts

import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Part resource
 */
export const PART_FIELDS: Record<string, ResourceField> = {
  id: {
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    dbColumn: 'id',
    nullable: false,
    isIdentifier: true,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    description: 'Unique part identifier',
  },

  title: {
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    dbColumn: 'title',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
    },
    placeholder: 'Enter part title',
  },

  sku: {
    key: 'sku',
    label: 'SKU',
    type: BaseType.STRING,
    dbColumn: 'sku',
    nullable: false,
    isIdentifier: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
    },
    placeholder: 'Enter SKU',
    description: 'Stock Keeping Unit - must be unique',
  },

  description: {
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    dbColumn: 'description',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter description',
  },

  category: {
    key: 'category',
    label: 'Category',
    type: BaseType.STRING,
    dbColumn: 'category',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter category',
  },

  cost: {
    key: 'cost',
    label: 'Cost',
    type: BaseType.CURRENCY,
    dbColumn: 'cost',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Calculated from vendor parts and BOM',
  },

  hsCode: {
    key: 'hsCode',
    label: 'HS Code',
    type: BaseType.STRING,
    dbColumn: 'hsCode',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter HS code',
    description: 'Harmonized System code for customs',
  },

  shopifyProductLinkId: {
    key: 'shopifyProductLinkId',
    label: 'Shopify Product',
    type: BaseType.STRING,
    dbColumn: 'shopifyProductLinkId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    description: 'Linked Shopify product ID',
  },

  createdAt: {
    key: 'createdAt',
    label: 'Created At',
    type: BaseType.DATETIME,
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Automatically set when part is created',
  },

  updatedAt: {
    key: 'updatedAt',
    label: 'Updated At',
    type: BaseType.DATETIME,
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Automatically updated when part is modified',
  },

  createdBy: {
    key: 'createdBy',
    label: 'Created By',
    type: BaseType.RELATION,
    dbColumn: 'createdById',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    relationship: {
      targetTable: 'user',
      cardinality: 'many-to-one',
      reciprocalField: undefined,
    },
    description: 'User who created this part',
  },
}
