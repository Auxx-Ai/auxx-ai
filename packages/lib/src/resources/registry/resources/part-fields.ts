// packages/lib/src/resources/registry/resources/part-fields.ts

import { FieldType } from '@auxx/database/enums'
import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Part resource
 */
export const PART_FIELDS: Record<string, ResourceField> = {
  id: {
    id: 'id',
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemSortOrder: -1,
    showInPanel: false,
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
    id: 'title',
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemSortOrder: 10,
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
    id: 'sku',
    key: 'sku',
    label: 'SKU',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemSortOrder: 15,
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
    id: 'description',
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemSortOrder: 20,
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
    id: 'category',
    key: 'category',
    label: 'Category',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemSortOrder: 25,
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
    id: 'cost',
    key: 'cost',
    label: 'Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemSortOrder: 35,
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
    id: 'hsCode',
    key: 'hsCode',
    label: 'HS Code',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemSortOrder: 30,
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
    id: 'shopifyProductLinkId',
    key: 'shopifyProductLinkId',
    label: 'Shopify Product',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    showInPanel: false, // Internal linking field
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
    id: 'createdAt',
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemSortOrder: 100,
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
    id: 'updatedAt',
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemSortOrder: 101,
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
    id: 'createdBy',
    key: 'createdBy',
    label: 'Created By',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    showInPanel: false, // Internal tracking field
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
