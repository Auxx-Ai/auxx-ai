// packages/lib/src/resources/registry/resources/catalog-group-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/** Percent-of-subtotal vs flat-amount discount — same shape as `QUOTE_DISCOUNT_TYPE_OPTIONS`. */
const CATALOG_GROUP_DISCOUNT_TYPE_OPTIONS = [
  { label: 'Percent', value: 'percent', color: 'blue' },
  { label: 'Amount', value: 'amount', color: 'purple' },
] as const

/**
 * Field definitions for the Catalog Group resource (product-bundle "packages",
 * plans/dispatch/money/09-product-groups.md). Hidden system entity — managed from dispatch
 * settings, never shown in the entity sidebar. Mirrors CATALOG_ITEM_FIELDS.
 */
export const CATALOG_GROUP_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique catalog group identifier',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'catalog_group_name',
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
    placeholder: 'Enter group name',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'catalog_group_description',
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

  entries: {
    id: toFieldId('entries'),
    key: 'entries',
    label: 'Entries',
    type: BaseType.JSON,
    fieldType: FieldType.JSON,
    isSystem: true,
    systemAttribute: 'catalog_group_entries',
    systemSortOrder: 'a3',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Ordered array of catalog-item entries (catalogItemId, qty, overrides)',
  },

  taxRateId: {
    id: toFieldId('taxRateId'),
    key: 'taxRateId',
    label: 'Tax Rate',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'catalog_group_tax_rate_id',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Id of a documents.taxRates preset — resolved live at insert, not snapshotted',
  },

  discountType: {
    id: toFieldId('discountType'),
    key: 'discountType',
    label: 'Discount Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'catalog_group_discount_type',
    systemSortOrder: 'a5',
    nullable: true,
    options: { options: [...CATALOG_GROUP_DISCOUNT_TYPE_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select discount type',
    description: 'Null = no discount',
  },

  discountValue: {
    id: toFieldId('discountValue'),
    key: 'discountValue',
    label: 'Discount Value',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'catalog_group_discount_value',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Percent = plain number, amount = integer cents (quote_discount_value convention)',
  },

  active: {
    id: toFieldId('active'),
    key: 'active',
    label: 'Active',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'catalog_group_active',
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
    description: 'Inactive groups are hidden from the picker but keep historical lines',
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
    description: 'Automatically set when the catalog group is created',
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
    description: 'Automatically updated when the catalog group is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
