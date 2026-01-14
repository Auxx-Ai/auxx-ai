// packages/lib/src/resources/registry/entity-instance-fields.ts

import { FieldType } from '@auxx/database/enums'
import { BaseType } from '../../workflow-engine/core/types'
import type { ResourceField } from './field-types'

/**
 * Implicit system fields for all EntityInstance records.
 * These are the columns on EntityInstance table that every custom entity has.
 * Added to custom resource field lists so they appear in field pickers.
 */
export const ENTITY_INSTANCE_FIELDS: Record<string, ResourceField> = {
  id: {
    id: 'id',
    key: 'id',
    label: 'Record ID',
    name: 'Record ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'record_id',
    systemSortOrder: -1,
    showInPanel: false, // Never show ID in property panel
    dbColumn: 'id',
    nullable: false,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique record identifier',
  },
  createdAt: {
    id: 'createdAt',
    key: 'createdAt',
    label: 'Created',
    name: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 100,
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
    id: 'updatedAt',
    key: 'updatedAt',
    label: 'Updated',
    name: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 101,
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
}

/**
 * Get entity instance fields as an array
 */
export function getEntityInstanceFields(): ResourceField[] {
  return Object.values(ENTITY_INSTANCE_FIELDS)
}
