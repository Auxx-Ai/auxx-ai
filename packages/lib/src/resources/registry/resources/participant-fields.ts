// packages/lib/src/workflow-engine/resources/registry/resources/participant-fields.ts

import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Participant resource
 * Defines all fields, their types, capabilities, and validation rules
 */
export const PARTICIPANT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique participant identifier',
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
    description: 'Participant email address',
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
    description: 'Participant name',
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
    description: 'Automatically set when participant is created',
  },
}
