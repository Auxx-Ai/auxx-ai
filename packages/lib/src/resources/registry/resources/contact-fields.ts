// packages/lib/src/workflow-engine/resources/registry/resources/contact-fields.ts

import { BaseType } from '../../types'

import type { ResourceField } from '../field-types'
import { ContactStatus } from '../enum-values'

/**
 * Field definitions for the Contact resource
 * Defines all fields, their types, capabilities, and validation rules
 */
export const CONTACT_FIELDS: Record<string, ResourceField> = {
  id: {
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    dbColumn: 'id',
    nullable: false,
    isIdentifier: true, // Can match existing contacts by ID
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    description: 'Unique contact identifier',
  },

  firstName: {
    key: 'firstName',
    label: 'First Name',
    type: BaseType.STRING,
    dbColumn: 'firstName',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter first name',
  },

  lastName: {
    key: 'lastName',
    label: 'Last Name',
    type: BaseType.STRING,
    dbColumn: 'lastName',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter last name',
  },

  name: {
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    dbColumn: undefined,
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    placeholder: 'Enter full name',
    description:
      'Full name (computed from firstName and lastName). Use firstName or lastName for filtering/sorting.',
  },

  email: {
    key: 'email',
    label: 'Email',
    type: BaseType.EMAIL,
    dbColumn: 'email',
    nullable: false,
    isIdentifier: true, // Can match existing contacts by email
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
    },
    placeholder: 'Enter email address',
    validation: {
      pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
    },
  },

  phone: {
    key: 'phone',
    label: 'Phone',
    type: BaseType.PHONE,
    dbColumn: 'phone',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter phone number',
  },

  status: {
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    dbColumn: 'status',
    nullable: false,
    enumValues: ContactStatus.values,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Select status',
    defaultValue: 'ACTIVE',
  },

  tags: {
    key: 'tags',
    label: 'Tags',
    type: BaseType.ARRAY,
    dbColumn: 'tags',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter tags',
    description: 'Tags for organizing contacts',
  },

  notes: {
    key: 'notes',
    label: 'Notes',
    type: BaseType.STRING,
    dbColumn: 'notes',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter notes',
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
    description: 'Automatically set when contact is created',
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
    description: 'Automatically updated when contact is modified',
  },

  // Reverse relationship: tickets (one-to-many)
  tickets: {
    key: 'tickets',
    label: 'Tickets',
    type: BaseType.RELATION,
    // NO dbColumn - computed from ticket.contactId
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    relationship: {
      targetTable: 'ticket',
      cardinality: 'one-to-many',
      reciprocalField: 'contact',
      // FK is in ticket table (ticket.contactId)
    },
    description: 'All tickets associated with this contact',
  },
}
