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
    defaultValue: 'indigo',
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

  defaultLens: {
    id: toFieldId('defaultLens'),
    key: 'defaultLens',
    label: 'Default Access',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'inbox_default_lens',
    systemSortOrder: 'a5a',
    nullable: false,
    defaultValue: 'full',
    options: {
      options: [
        { value: 'none', label: 'No access' },
        { value: 'metadata', label: 'Activity only' },
        { value: 'subject', label: 'Subject only' },
        { value: 'full', label: 'Full access' },
      ],
    },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Org-wide visibility floor: the lens every org member gets on this inbox. Explicit grants can only raise it (mail-permissions §2.2).',
  },

  isPersonal: {
    id: toFieldId('isPersonal'),
    key: 'isPersonal',
    label: 'Personal',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'inbox_is_personal',
    systemSortOrder: 'a5b',
    nullable: false,
    defaultValue: false,
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Personal-account inbox (mail-permissions §11): owned by one user, admins capped at activity-only, invisible to automation. Set by the personal connect flow; cleared by an admin claim.',
  },

  ownerUserId: {
    id: toFieldId('ownerUserId'),
    key: 'ownerUserId',
    label: 'Owner',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'inbox_owner_user_id',
    systemSortOrder: 'a5c',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'User id of the personal-inbox owner (mail-permissions §11). Null on shared org inboxes.',
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
