// packages/lib/src/resources/registry/resources/signature-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Signature resource.
 * These get seeded as CustomFields in the entity system.
 */
export const SIGNATURE_FIELDS: Record<string, ResourceField> = {
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
    nullable: false,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique signature identifier',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'name',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
      required: true,
    },
    description: 'Signature name for identification',
  },

  body: {
    id: toFieldId('body'),
    key: 'body',
    label: 'Body',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'body',
    systemSortOrder: 'a2',
    nullable: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
      required: true,
    },
    description: 'HTML content of the signature',
  },

  isDefault: {
    id: toFieldId('isDefault'),
    key: 'isDefault',
    label: 'Default',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'is_default',
    systemSortOrder: 'a3',
    nullable: false,
    defaultValue: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Whether this is the default signature',
  },

  visibility: {
    id: toFieldId('visibility'),
    key: 'visibility',
    label: 'Visibility',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'visibility',
    systemSortOrder: 'a4',
    nullable: false,
    defaultValue: 'private',
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
    description: 'Signature visibility setting',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a5',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when signature is created',
  },

  createdBy: CREATED_BY_FIELD,
}
