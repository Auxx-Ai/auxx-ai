// packages/lib/src/workflow-engine/resources/registry/resources/contact-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { ContactStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

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
    systemSortOrder: 'a0',
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
      configurable: false,
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
      configurable: false,
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
      configurable: false,
    },
    placeholder: 'Enter last name',
  },

  fullName: {
    id: toFieldId('fullName'),
    key: 'fullName',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.NAME,
    isSystem: true,
    systemAttribute: 'full_name',
    systemSortOrder: 'a1',
    dbColumn: undefined, // Not a real column
    sourceFields: ['firstName', 'lastName'], // Read from these fields
    targetFields: ['firstName', 'lastName'], // Write to these fields
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter full name',
    description:
      'Full name (computed from firstName and lastName). Use firstName or lastName for filtering/sorting.',
  },

  avatarUrl: {
    id: toFieldId('avatarUrl'),
    key: 'avatarUrl',
    label: 'Avatar',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'contact_avatar',
    systemSortOrder: 'a1a',
    showInPanel: false,
    nullable: true,
    options: {
      file: { allowMultiple: false, allowedFileTypes: ['image'] },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Contact avatar image',
  },

  primaryEmail: {
    id: toFieldId('primaryEmail'),
    key: 'primaryEmail',
    label: 'Email',
    type: BaseType.EMAIL,
    fieldType: FieldType.EMAIL,
    isSystem: true,
    systemAttribute: 'primary_email',
    systemSortOrder: 'a2',
    dbColumn: 'email',
    nullable: true,
    isIdentifier: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
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
    systemSortOrder: 'a3',
    dbColumn: 'phone',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
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
    systemSortOrder: 'a4',
    dbColumn: 'status',
    nullable: false,
    options: { options: ContactStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
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
    systemSortOrder: 'a5',
    dynamicOptionsKey: 'contactGroups', // Maps to DYNAMIC_OPTIONS_REGISTRY
    dbColumn: 'customerGroups',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
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
    systemSortOrder: 'a6',
    dbColumn: 'notes',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter notes',
  },

  externalId: {
    id: toFieldId('externalId'),
    key: 'externalId',
    label: 'External ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'external_id',
    systemSortOrder: 'b0',
    showInPanel: false,
    nullable: true,
    isIdentifier: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Stable source identifier (e.g. linkedin:slug, gmail:email) set when a record is captured via the Auxx extension.',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a8',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
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
    systemSortOrder: 'a9',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
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
    systemAttribute: 'contact_tickets',
    systemSortOrder: 'a7',
    showInPanel: false, // Relationship reverse-field
    // NO dbColumn - computed from ticket.contactId
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'ticket:contact' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'All tickets associated with this contact',
  },

  // Reverse relationship: vendorParts (one-to-many from vendor_part.contact)
  vendorParts: {
    id: toFieldId('vendorParts'),
    key: 'vendorParts',
    label: 'Vendor Parts',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'contact_vendor_parts',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_part:contact' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Vendor parts supplied by this contact',
  },

  // Reverse relationship: company (from company.primaryContact)
  company: {
    id: toFieldId('company'),
    key: 'company',
    label: 'Company',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'contact_company',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'company:primaryContact' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Companies where this contact is the primary contact',
  },

  // Reverse relationship: employer (from company.employees)
  employer: {
    id: toFieldId('employer'),
    key: 'employer',
    label: 'Employer',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'contact_employer',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'company:employees' as ResourceFieldId,
      relationshipType: 'has_one',
      isInverse: true,
    },
    description: 'The company this contact works for',
  },

  // Reverse relationship: meetings (from meeting.contact)
  meetings: {
    id: toFieldId('meetings'),
    key: 'meetings',
    label: 'Meetings',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'contact_meetings',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'meeting:contact' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Meetings associated with this contact',
  },

  createdBy: CREATED_BY_FIELD,
}
