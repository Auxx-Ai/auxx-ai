// packages/lib/src/resources/registry/resources/inbox-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Inbox resource
 * Defines all fields, their types, capabilities, and validation rules
 */
export const INBOX_FIELDS: Record<string, ResourceField> = {
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
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique inbox identifier',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'inbox_name',
    systemSortOrder: 'a1',
    dbColumn: 'name',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Inbox name',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'inbox_description',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Inbox description',
  },

  color: {
    id: toFieldId('color'),
    key: 'color',
    label: 'Color',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'inbox_color',
    systemSortOrder: 'a3',
    nullable: true,
    defaultValue: '#4F46E5',
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Inbox color for UI display',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'inbox_status',
    systemSortOrder: 'a4',
    nullable: false,
    defaultValue: 'ACTIVE',
    options: {
      options: [
        { value: 'ACTIVE', label: 'Active', color: 'green' },
        { value: 'PAUSED', label: 'Paused', color: 'yellow' },
        { value: 'ARCHIVED', label: 'Archived', color: 'gray' },
      ],
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Inbox status',
  },

  visibility: {
    id: toFieldId('visibility'),
    key: 'visibility',
    label: 'Visibility',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'inbox_visibility',
    systemSortOrder: 'a5',
    nullable: false,
    defaultValue: 'org_members',
    options: {
      options: [
        { value: 'org_members', label: 'All Members' },
        { value: 'private', label: 'Private' },
        { value: 'custom', label: 'Custom' },
      ],
    },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Inbox visibility setting',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created At',
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
    description: 'Automatically set when inbox is created',
  },

  settings: {
    id: toFieldId('settings'),
    key: 'settings',
    label: 'Settings',
    type: BaseType.JSON,
    fieldType: FieldType.JSON,
    isSystem: true,
    systemAttribute: 'inbox_settings',
    systemSortOrder: 'a7',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Inbox configuration settings stored as JSON',
  },

  createdBy: CREATED_BY_FIELD,
}
