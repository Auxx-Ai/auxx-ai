// packages/lib/src/workflow-engine/resources/registry/resources/user-fields.ts

import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the User resource
 * Defines all fields, their types, capabilities, and validation rules
 */
export const USER_FIELDS: Record<string, ResourceField> = {
  id: {
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    dbColumn: 'id',
    nullable: false,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    description: 'Unique user identifier',
  },

  email: {
    key: 'email',
    label: 'Email',
    type: BaseType.EMAIL,
    dbColumn: 'email',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'User email address',
  },

  name: {
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    dbColumn: 'name',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'User full name',
  },

  // Reverse relationship: assignedTickets (one-to-many)
  assignedTickets: {
    key: 'assignedTickets',
    label: 'Assigned Tickets',
    type: BaseType.RELATION,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    relationship: {
      relatedEntityDefinitionId: 'ticket',
      relationshipType: 'has_many',
    },
    description: 'Tickets assigned to this user',
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
    description: 'Automatically set when user is created',
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
    description: 'Automatically updated when user is modified',
  },
}
