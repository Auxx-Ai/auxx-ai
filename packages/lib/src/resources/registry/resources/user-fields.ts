// packages/lib/src/workflow-engine/resources/registry/resources/user-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the User resource.
 *
 * Scope kept intentionally minimal — the user resource is only used for
 * sender/actor context in placeholders today. Relationship traversals
 * (`user:…::…`) are not supported; if you need to expose another column,
 * add it here AND register it in the `user:<slug>` synthetic path in
 * `packages/lib/src/placeholders/path-parser.ts`.
 */
export const USER_FIELDS: Record<string, ResourceField> = {
  id: {
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
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
    description: 'Unique user identifier',
  },

  email: {
    id: toFieldId('email'),
    key: 'email',
    label: 'Email',
    type: BaseType.EMAIL,
    fieldType: FieldType.EMAIL,
    dbColumn: 'email',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'User email address',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    dbColumn: 'name',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'User full name',
  },

  firstName: {
    id: toFieldId('firstName'),
    key: 'firstName',
    label: 'First Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    dbColumn: 'firstName',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'User first name',
  },

  lastName: {
    id: toFieldId('lastName'),
    key: 'lastName',
    label: 'Last Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    dbColumn: 'lastName',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'User last name',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when user is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when user is modified',
  },
}
