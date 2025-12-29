// packages/lib/src/workflow-engine/resources/registry/resources/ticket-fields.ts

import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'
import { TicketType, TicketStatus, TicketPriority } from '../enum-values'

/**
 * Field definitions for the Ticket resource
 * Defines all fields, their types, capabilities, and validation rules
 */
export const TICKET_FIELDS: Record<string, ResourceField> = {
  id: {
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    dbColumn: 'id',
    nullable: false,
    isIdentifier: true, // Can match existing tickets by ID
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    description: 'Unique ticket identifier',
  },

  number: {
    key: 'number',
    label: 'Ticket Number',
    type: BaseType.NUMBER,
    dbColumn: 'number',
    nullable: false,
    isIdentifier: true, // Can match existing tickets by number
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Sequential ticket number',
  },

  title: {
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    dbColumn: 'title',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
    },
    placeholder: 'Enter ticket title',
    validation: {
      minLength: 1,
      maxLength: 500,
    },
  },

  type: {
    key: 'type',
    label: 'Type',
    type: BaseType.ENUM,
    dbColumn: 'type',
    nullable: false,
    enumValues: TicketType.values,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false, // Type cannot be changed after creation
      required: true,
    },
    placeholder: 'Select ticket type',
    description: 'Ticket type cannot be changed after creation',
    defaultValue: 'GENERAL',
  },

  status: {
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    dbColumn: 'status',
    nullable: false,
    enumValues: TicketStatus.values,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Select status',
    defaultValue: 'OPEN',
  },

  priority: {
    key: 'priority',
    label: 'Priority',
    type: BaseType.ENUM,
    dbColumn: 'priority',
    nullable: false,
    enumValues: TicketPriority.values,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Select priority',
    defaultValue: 'MEDIUM',
  },

  contact: {
    key: 'contact',
    label: 'Contact',
    type: BaseType.RELATION,
    dbColumn: 'contactId', // Physical FK column in database
    nullable: false,
    capabilities: {
      filterable: true, // Can filter by .referenceId
      sortable: false, // Can't sort by object
      creatable: true, // Can set via { referenceId: '...' }
      updatable: false, // Cannot reassign ticket to different contact
      required: true,
    },
    relationship: {
      targetTable: 'contact',
      targetField: 'id',
      cardinality: 'many-to-one',
      reciprocalField: 'tickets',
      required: true,
      onDelete: 'RESTRICT', // Can't delete contact with tickets
    },
    placeholder: 'Select a contact',
    description: 'The contact this ticket belongs to',
  },

  description: {
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    dbColumn: 'description',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter ticket description',
  },

  assignee: {
    key: 'assignee',
    label: 'Assignee',
    type: BaseType.RELATION,
    dbColumn: 'assignedToId', // Physical FK column in database
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true, // Can reassign tickets
    },
    relationship: {
      targetTable: 'user',
      targetField: 'id',
      cardinality: 'many-to-one',
      reciprocalField: 'assignedTickets',
      required: false,
      onDelete: 'SET_NULL', // If user deleted, clear assignee
    },
    placeholder: 'Select an assignee',
    description: 'Team member assigned to this ticket',
  },

  parentTicket: {
    key: 'parentTicket',
    label: 'Parent Ticket',
    type: BaseType.RELATION,
    dbColumn: 'parentTicketId', // Physical FK column in database
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    relationship: {
      targetTable: 'ticket', // Self-reference
      targetField: 'id',
      cardinality: 'many-to-one',
      reciprocalField: 'childTickets',
      required: false,
    },
    placeholder: 'Select parent ticket',
    description: 'Parent ticket for hierarchical relationships',
  },

  // Reverse relationship: childTickets (one-to-many)
  childTickets: {
    key: 'childTickets',
    label: 'Child Tickets',
    type: BaseType.RELATION,
    // NO dbColumn - this is computed from other side
    capabilities: {
      filterable: false, // Can't filter by array
      sortable: false, // Can't sort by array
      creatable: false, // Set from other side
      updatable: false, // Set from other side
    },
    relationship: {
      targetTable: 'ticket',
      cardinality: 'one-to-many',
      reciprocalField: 'parentTicket',
      // Foreign key is in target table (ticket.parentTicketId)
    },
    description: 'All child tickets of this ticket',
  },

  dueDate: {
    key: 'dueDate',
    label: 'Due Date',
    type: BaseType.DATE,
    dbColumn: 'dueDate',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Select due date',
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
    description: 'Automatically set when ticket is created',
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
    description: 'Automatically updated when ticket is modified',
  },
}
