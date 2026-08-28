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
    operatorOverrides: ['is', 'is not', 'in', 'not in'],
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
    // Multi-value: a contact can hold up to MAX_MULTI_VALUES addresses; the
    // first (by sortKey) is the primary. Existing orgs are caught up by data
    // migration 085.
    options: { multi: true },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
      // Org-wide per-value uniqueness. `isUnique` on the seeded CustomField row
      // arms the FieldValueService gate (`checkUniqueValueTyped`) — the ONLY
      // uniqueness door for panel/bulk-edit writes, which never run contact
      // hooks. Existing orgs are caught up by data migration 084.
      unique: true,
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
    // Multi-value: a contact can hold up to MAX_MULTI_VALUES numbers; the first
    // (by sortKey) is the primary and is what outbound SMS/voice dials. Existing
    // orgs are caught up by data migration 086. Unlike `primaryEmail` this field
    // is deliberately NOT unique — households and companies legitimately share a
    // line, and arming the uniqueness gate here would 409 ordinary ingest writes.
    options: { multi: true },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter phone number',
  },

  jobTitle: {
    id: toFieldId('jobTitle'),
    key: 'jobTitle',
    label: 'Job Title',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'job_title',
    systemSortOrder: 'a3a',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter job title',
  },

  city: {
    id: toFieldId('city'),
    key: 'city',
    label: 'City',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'city',
    systemSortOrder: 'a3b',
    nullable: true,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'San Francisco',
  },

  region: {
    id: toFieldId('region'),
    key: 'region',
    label: 'Region',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'region',
    systemSortOrder: 'a3c',
    nullable: true,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'California',
  },

  country: {
    id: toFieldId('country'),
    key: 'country',
    label: 'Country',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'country',
    systemSortOrder: 'a3d',
    nullable: true,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'United States',
  },

  timezone: {
    id: toFieldId('timezone'),
    key: 'timezone',
    label: 'Timezone',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'timezone',
    systemSortOrder: 'a3e',
    nullable: true,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'America/Los_Angeles',
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

  firstInteractionAt: {
    id: toFieldId('firstInteractionAt'),
    key: 'firstInteractionAt',
    label: 'First interaction',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'first_interaction_at',
    systemSortOrder: 'a7a',
    dbColumn: 'firstInteractionAt',
    nullable: true,
    showInTable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Oldest real correspondence with this contact (message time, ingest-derived)',
  },

  lastInteractionAt: {
    id: toFieldId('lastInteractionAt'),
    key: 'lastInteractionAt',
    label: 'Last interaction',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'last_interaction_at',
    systemSortOrder: 'a7b',
    dbColumn: 'lastInteractionAt',
    nullable: true,
    showInTable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Newest real correspondence with this contact (message time, ingest-derived)',
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

  // Reverse relationship: workOrders (from work_order.contact)
  workOrders: {
    id: toFieldId('workOrders'),
    key: 'workOrders',
    label: 'Work Orders',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'contact_work_orders',
    showInPanel: false,
    systemSortOrder: 'aA',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'work_order:contact' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Work orders for this contact',
  },

  // Reverse relationship: serviceRequests (from service_request.contact)
  serviceRequests: {
    id: toFieldId('serviceRequests'),
    key: 'serviceRequests',
    label: 'Service Requests',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'contact_service_requests',
    showInPanel: false,
    systemSortOrder: 'aB',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'service_request:contact' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Service requests for this contact',
  },

  // Reverse relationship: quotes (from quote.contact)
  quotes: {
    id: toFieldId('quotes'),
    key: 'quotes',
    label: 'Quotes',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'contact_quotes',
    showInPanel: false,
    systemSortOrder: 'aC',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'quote:contact' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Quotes for this contact',
  },

  // Reverse relationship: invoices (from invoice.contact)
  invoices: {
    id: toFieldId('invoices'),
    key: 'invoices',
    label: 'Invoices',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'contact_invoices',
    showInPanel: false,
    systemSortOrder: 'aD',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'invoice:contact' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Invoices for this contact',
  },

  // Reverse relationship: orders (from order.contact)
  orders: {
    id: toFieldId('orders'),
    key: 'orders',
    label: 'Orders',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'contact_orders',
    showInPanel: false,
    systemSortOrder: 'aH',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'order:contact' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Orders placed by this contact',
  },

  // Reverse relationship: purchase orders (from purchase_order.contact).
  // The BUY side: this contact works for a supplier and is who our orders are
  // addressed to — the mirror of `orders`, which is what they bought from us.
  purchaseOrders: {
    id: toFieldId('purchaseOrders'),
    key: 'purchaseOrders',
    label: 'Purchase Orders',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'contact_purchase_orders',
    showInPanel: false,
    systemSortOrder: 'aI',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'purchase_order:contact' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Purchase orders addressed to this contact',
  },

  balanceDue: {
    id: toFieldId('balanceDue'),
    key: 'balanceDue',
    label: 'Balance Due',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'contact_balance_due',
    systemSortOrder: 'aE',
    showInPanel: false,
    nullable: false,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    defaultValue: 0,
    description: 'Read-only sum of non-void issued invoice balances',
  },

  uninvoicedAmount: {
    id: toFieldId('uninvoicedAmount'),
    key: 'uninvoicedAmount',
    label: 'Uninvoiced Work',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'contact_uninvoiced_amount',
    systemSortOrder: 'aF',
    showInPanel: false,
    nullable: false,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    defaultValue: 0,
    description: 'Read-only sum of currently eligible uninvoiced work',
  },

  billingRevision: {
    id: toFieldId('billingRevision'),
    key: 'billingRevision',
    label: 'Billing Revision',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'contact_billing_revision',
    systemSortOrder: 'aG',
    showInPanel: false,
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
      hidden: true,
    },
    defaultValue: '',
    description: 'Opaque token used to invalidate the contact billing overview',
  },

  createdBy: CREATED_BY_FIELD,
}
