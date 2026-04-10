// packages/lib/src/resources/registry/resources/stock-movement-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { StockMovementType } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Stock Movement resource.
 * Stock movements are append-only ledger entries tracking inventory changes.
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
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
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

  createdBy: CREATED_BY_FIELD,
}
