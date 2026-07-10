// packages/lib/src/resources/registry/resources/service-request-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/** Residential vs commercial — informs crew/pricing later, no company link needed (01 §9). */
const SERVICE_REQUEST_PROPERTY_TYPE_OPTIONS = [
  { label: 'Residential', value: 'residential', color: 'blue' },
  { label: 'Commercial', value: 'commercial', color: 'purple' },
] as const

/**
 * ⚠️ PROVISIONAL — reasonable defaults, not validated against real scheduling UX
 * (04-ui.md). Revisit once the intake dialog and board are designed.
 */
const SERVICE_REQUEST_ARRIVAL_WINDOW_OPTIONS = [
  { label: 'Morning', value: 'morning', color: 'blue' },
  { label: 'Afternoon', value: 'afternoon', color: 'amber' },
  { label: 'Evening', value: 'evening', color: 'purple' },
  { label: 'Anytime', value: 'anytime', color: 'gray' },
] as const

/**
 * ⚠️ PROVISIONAL lifecycle (README §Decisions, 01 §9) — the quoting module
 * (separate future plan) may reshape `quoted`/`approved`.
 */
const SERVICE_REQUEST_STATUS_OPTIONS = [
  { label: 'New', value: 'new', color: 'gray' },
  { label: 'Contacted', value: 'contacted', color: 'blue' },
  { label: 'Quoted', value: 'quoted', color: 'purple' },
  { label: 'Approved', value: 'approved', color: 'teal' },
  { label: 'Converted', value: 'converted', color: 'green' },
  { label: 'Lost', value: 'lost', color: 'red' },
  { label: 'Canceled', value: 'canceled', color: 'gray' },
] as const

/**
 * Field definitions for the Service Request resource.
 * Defines all fields, their types, capabilities, and validation rules.
 */
export const SERVICE_REQUEST_FIELDS: Record<string, ResourceField> = {
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
    isIdentifier: true,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique service request identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'service_request_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // hook-generated (§F.4b) — the hook is the ONLY writer
      updatable: false,
      configurable: false,
    },
    description: 'Auto-generated service request number',
  },

  title: {
    id: toFieldId('title'),
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'service_request_title',
    systemSortOrder: 'a2',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Enter service request title',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'service_request_description',
    systemSortOrder: 'a3',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter service request description',
  },

  propertyType: {
    id: toFieldId('propertyType'),
    key: 'propertyType',
    label: 'Property Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'service_request_property_type',
    systemSortOrder: 'a4',
    nullable: true,
    options: { options: [...SERVICE_REQUEST_PROPERTY_TYPE_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select property type',
    defaultValue: 'residential',
  },

  preferredDate: {
    id: toFieldId('preferredDate'),
    key: 'preferredDate',
    label: 'Preferred Date',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'service_request_preferred_date',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Which day works best?',
  },

  alternateDate: {
    id: toFieldId('alternateDate'),
    key: 'alternateDate',
    label: 'Alternate Date',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'service_request_alternate_date',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: "Second choice, if the preferred date doesn't work",
  },

  arrivalWindow: {
    id: toFieldId('arrivalWindow'),
    key: 'arrivalWindow',
    label: 'Arrival Window',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'service_request_arrival_window',
    systemSortOrder: 'a7',
    nullable: true,
    options: { options: [...SERVICE_REQUEST_ARRIVAL_WINDOW_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select arrival window',
    defaultValue: 'anytime',
  },

  contact: {
    id: toFieldId('contact'),
    key: 'contact',
    label: 'Contact',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'service_request_contact',
    systemSortOrder: 'a8',
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'contact:serviceRequests' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'contact',
      relationshipType: 'belongs_to',
      inverseName: 'Service Requests',
      inverseSystemAttribute: 'contact_service_requests',
    },
    description: 'Customer contact for this request — carries the customer info',
  },

  serviceAddress: {
    id: toFieldId('serviceAddress'),
    key: 'serviceAddress',
    label: 'Service Address',
    type: BaseType.OBJECT,
    fieldType: FieldType.ADDRESS_STRUCT,
    isSystem: true,
    systemAttribute: 'service_request_address',
    systemSortOrder: 'a9',
    nullable: true,
    options: { addressComponents: ['street', 'city', 'state', 'country'] },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Where the work happens — prefilled from the contact, editable if the site differs',
  },

  ticket: {
    id: toFieldId('ticket'),
    key: 'ticket',
    label: 'Ticket',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'service_request_ticket',
    systemSortOrder: 'aA',
    nullable: true,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'ticket:serviceRequests' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'ticket',
      relationshipType: 'belongs_to',
      inverseName: 'Service Requests',
      inverseSystemAttribute: 'ticket_service_requests',
    },
    description: 'Ticket this request is linked to',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'service_request_status',
    systemSortOrder: 'aB',
    nullable: false,
    options: { options: [...SERVICE_REQUEST_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'new',
  },

  // Reverse relationship: workOrders (from work_order.request)
  workOrders: {
    id: toFieldId('workOrders'),
    key: 'workOrders',
    label: 'Work Orders',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'service_request_work_orders',
    systemSortOrder: 'aC',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'work_order:request' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Work orders converted from this service request',
  },

  // Reverse relationship: quotes (from quote.request)
  quotes: {
    id: toFieldId('quotes'),
    key: 'quotes',
    label: 'Quotes',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'service_request_quotes',
    systemSortOrder: 'aD',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'quote:request' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Quotes created from this service request',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'aE',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the service request is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'aF',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the service request is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
