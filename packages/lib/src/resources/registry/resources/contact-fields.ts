// packages/lib/src/workflow-engine/resources/registry/resources/contact-fields.ts

import { FieldType } from '@auxx/database/enums'
import { BaseType } from '../../types'
import { toFieldId } from '@auxx/types/field'

import type { ResourceField } from '../field-types'
import { ContactStatus } from '../enum-values'

/**
 * Field definitions for the Contact resource
 * Defines all fields, their types, capabilities, and validation rules
 */
export const CONTACT_FIELDS: Record<string, ResourceField> = {
  id: {
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'id',
    systemSortOrder: -1,
    showInPanel: false, // Never shown in property panel
    dbColumn: 'id',
    nullable: false,
    isIdentifier: true,
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
    id: toFieldId('firstName'),
    key: 'firstName',
    label: 'First Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'first_name',
    showInPanel: false, // Hidden - use 'name' computed field instead
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
    id: toFieldId('lastName'),
    key: 'lastName',
    label: 'Last Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'last_name',
    showInPanel: false, // Hidden - use 'name' computed field instead
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
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.NAME,
    isSystem: true,
    systemAttribute: 'full_name',
    systemSortOrder: 10,
    dbColumn: undefined, // Not a real column
    sourceFields: ['firstName', 'lastName'], // Read from these fields
    targetFields: ['firstName', 'lastName'], // Write to these fields
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter full name',
    description:
      'Full name (computed from firstName and lastName). Use firstName or lastName for filtering/sorting.',
  },

  email: {
    id: toFieldId('email'),
    key: 'email',
    label: 'Email',
    type: BaseType.EMAIL,
    fieldType: FieldType.EMAIL,
    isSystem: true,
    systemAttribute: 'primary_email',
    systemSortOrder: 20,
    dbColumn: 'email',
    nullable: false,
    isIdentifier: true,
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
    id: toFieldId('phone'),
    key: 'phone',
    label: 'Phone',
    type: BaseType.PHONE,
    fieldType: FieldType.PHONE_INTL,
    isSystem: true,
    systemAttribute: 'phone',
    systemSortOrder: 30,
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
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'contact_status',
    systemSortOrder: 40,
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

  customerGroups: {
    id: toFieldId('customerGroups'),
    key: 'customerGroups',
    label: 'Groups',
    type: BaseType.ARRAY,
    fieldType: FieldType.MULTI_SELECT,
    isSystem: true,
    systemAttribute: 'customer_groups',
    systemSortOrder: 50,
    dynamicOptionsKey: 'contactGroups', // Maps to DYNAMIC_OPTIONS_REGISTRY
    dbColumn: 'customerGroups',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Select groups',
    description: 'Customer groups for organizing contacts',
  },

  // tags: {
  //   id: 'tags',
  //   key: 'tags',
  //   label: 'Tags',
  //   type: BaseType.ARRAY,
  //   fieldType: FieldType.TAGS,
  //   isSystem: true,
  //   systemSortOrder: 60,
  //   dynamicOptionsKey: 'tags',
  //   dbColumn: 'tags',
  //   nullable: true,
  //   capabilities: {
  //     filterable: false,
  //     sortable: false,
  //     creatable: true,
  //     updatable: true,
  //   },
  //   placeholder: 'Enter tags',
  //   description: 'Tags for organizing contacts',
  // },

  notes: {
    id: toFieldId('notes'),
    key: 'notes',
    label: 'Notes',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'notes',
    systemSortOrder: 70,
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
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 100, // System timestamps at bottom of system fields
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
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
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
    },
    description: 'Automatically updated when contact is modified',
  },

  // Reverse relationship: tickets (one-to-many)
  tickets: {
    id: toFieldId('tickets'),
    key: 'tickets',
    label: 'Tickets',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    showInPanel: false, // Relationship reverse-field, not editable
    // NO dbColumn - computed from ticket.contactId
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
    description: 'All tickets associated with this contact',
  },
}
