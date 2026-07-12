// packages/lib/src/resources/registry/resources/work-order-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/** Status options for the work order lifecycle (README §domain, 01 §5). */
const WORK_ORDER_STATUS_OPTIONS = [
  { label: 'New', value: 'new', color: 'gray' },
  { label: 'Scheduled', value: 'scheduled', color: 'blue' },
  { label: 'Dispatched', value: 'dispatched', color: 'purple' },
  { label: 'En Route', value: 'en_route', color: 'amber' },
  { label: 'On Site', value: 'on_site', color: 'teal' },
  { label: 'Completed', value: 'completed', color: 'green' },
  { label: 'Canceled', value: 'canceled', color: 'red' },
  // Recurring engagement statuses (dispatch M2c, 06-recurring-engine.md §3.3/§4.1) —
  // superset on the same field; jobType decides the valid subset, hook-guarded.
  { label: 'Active', value: 'active', color: 'green' },
  { label: 'Paused', value: 'paused', color: 'amber' },
  { label: 'Ended', value: 'ended', color: 'gray' },
] as const

const WORK_ORDER_PRIORITY_OPTIONS = [
  { label: 'Low', value: 'low', color: 'gray' },
  { label: 'Normal', value: 'normal', color: 'blue' },
  { label: 'High', value: 'high', color: 'amber' },
  { label: 'Urgent', value: 'urgent', color: 'red' },
] as const

/**
 * One work order record = the engagement (Jobber model, 01 §10). `recurring` just
 * marks the shape in M1 — the recurrence rule store, rolling-window visit
 * materialization, and per-visit edit semantics are the M2+ recurring engine (§I).
 * A recurring work order behaves exactly like a one-off in M1: one auto-created
 * visit (§E), no rule, no extra generation.
 */
const WORK_ORDER_JOB_TYPE_OPTIONS = [
  { label: 'One-off', value: 'one_off', color: 'blue' },
  { label: 'Recurring', value: 'recurring', color: 'purple' },
] as const

/** How this job bills — structure-only until the invoicing module (04-ui.md invoicing model). */
const WORK_ORDER_PRICING_MODEL_OPTIONS = [
  { label: 'Per visit', value: 'per_visit', color: 'blue' },
  { label: 'Fixed price', value: 'fixed', color: 'purple' },
] as const

/** When invoice drafts are generated — structure-only until the invoicing module. */
const WORK_ORDER_INVOICE_TIMING_OPTIONS = [
  { label: 'After each visit', value: 'per_visit_completed', color: 'blue' },
  { label: 'When job completes', value: 'on_completion', color: 'green' },
  { label: 'As needed', value: 'as_needed', color: 'gray' },
  { label: 'Custom schedule', value: 'custom_schedule', color: 'amber' },
] as const

/**
 * Field definitions for the Work Order resource.
 * Defines all fields, their types, capabilities, and validation rules.
 */
export const WORK_ORDER_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique work order identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'work_order_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // hook-generated (§F) — the hook is the ONLY writer
      updatable: false,
      configurable: false,
    },
    description: 'Auto-generated work order number',
  },

  title: {
    id: toFieldId('title'),
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'work_order_title',
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
    placeholder: 'Enter work order title',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'work_order_description',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter work order description',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'work_order_status',
    systemSortOrder: 'a5',
    nullable: false,
    showInDialogs: false, // new-job dialog starts every work order at the default status
    options: { options: [...WORK_ORDER_STATUS_OPTIONS] },
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

  priority: {
    id: toFieldId('priority'),
    key: 'priority',
    label: 'Priority',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'work_order_priority',
    systemSortOrder: 'a6',
    nullable: false,
    options: { options: [...WORK_ORDER_PRIORITY_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select priority',
    defaultValue: 'normal',
  },

  jobType: {
    id: toFieldId('jobType'),
    key: 'jobType',
    label: 'Job Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'work_order_job_type',
    systemSortOrder: 'a7',
    nullable: false,
    options: { options: [...WORK_ORDER_JOB_TYPE_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select job type',
    defaultValue: 'one_off',
    description: 'One-off vs recurring engagement (01 §10) — recurring engine lands in M2+',
  },

  contact: {
    id: toFieldId('contact'),
    key: 'contact',
    label: 'Contact',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'work_order_contact',
    systemSortOrder: 'a3',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'contact:workOrders' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'contact',
      relationshipType: 'belongs_to',
      inverseName: 'Work Orders',
      inverseSystemAttribute: 'contact_work_orders',
    },
    description: 'Customer contact for this work order',
  },

  company: {
    id: toFieldId('company'),
    key: 'company',
    label: 'Company',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'work_order_company',
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'company:workOrders' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'company',
      relationshipType: 'belongs_to',
      inverseName: 'Work Orders',
      inverseSystemAttribute: 'company_work_orders',
    },
    description: 'Company associated with this work order',
  },

  serviceAddress: {
    id: toFieldId('serviceAddress'),
    key: 'serviceAddress',
    label: 'Service Address',
    type: BaseType.OBJECT,
    fieldType: FieldType.ADDRESS_STRUCT,
    isSystem: true,
    systemAttribute: 'work_order_address',
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
    description: 'Where the work happens — may differ from the contact address',
  },

  ticket: {
    id: toFieldId('ticket'),
    key: 'ticket',
    label: 'Ticket',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'work_order_ticket',
    systemSortOrder: 'aA',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'ticket:workOrders' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'ticket',
      relationshipType: 'belongs_to',
      inverseName: 'Work Orders',
      inverseSystemAttribute: 'ticket_work_orders',
    },
    description: 'Ticket this work order was created from',
  },

  request: {
    id: toFieldId('request'),
    key: 'request',
    label: 'Service Request',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'work_order_request',
    systemSortOrder: 'aB',
    nullable: true,
    showInDialogs: false, // set by the convert flow, not picked in the new-job dialog
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'service_request:workOrders' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'service_request',
      relationshipType: 'belongs_to',
      inverseName: 'Work Orders',
      inverseSystemAttribute: 'service_request_work_orders',
    },
    description: 'Service request this work order was converted from',
  },

  scheduledStart: {
    id: toFieldId('scheduledStart'),
    key: 'scheduledStart',
    label: 'Scheduled Start',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'work_order_scheduled_start',
    systemSortOrder: 'aC',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // mirrored from the visit in M2 (01 §3)
      updatable: false,
      configurable: false,
    },
    description: 'Mirrored from the scheduled visit — edit via scheduling, not directly',
  },

  scheduledEnd: {
    id: toFieldId('scheduledEnd'),
    key: 'scheduledEnd',
    label: 'Scheduled End',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'work_order_scheduled_end',
    systemSortOrder: 'aD',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // mirrored from the visit in M2 (01 §3)
      updatable: false,
      configurable: false,
    },
    description: 'Mirrored from the scheduled visit — edit via scheduling, not directly',
  },

  assignee: {
    id: toFieldId('assignee'),
    key: 'assignee',
    label: 'Assignee',
    type: BaseType.ACTOR,
    fieldType: FieldType.ACTOR,
    isSystem: true,
    systemAttribute: 'work_order_assignee',
    systemSortOrder: 'aE',
    dynamicOptionsKey: 'teamMembers',
    nullable: true,
    options: { actor: { target: 'user', multiple: false } },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false, // mirrored from the visit in M2 (01 §3)
      updatable: false,
      configurable: false,
    },
    description: 'Field worker assigned to this work order (set via scheduling)',
  },

  completionNotes: {
    id: toFieldId('completionNotes'),
    key: 'completionNotes',
    label: 'Completion Notes',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'work_order_completion_notes',
    systemSortOrder: 'aF',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter completion notes',
    description: 'Notes recorded by the field worker at close-out (M2)',
  },

  pricingModel: {
    id: toFieldId('pricingModel'),
    key: 'pricingModel',
    label: 'Pricing Model',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'work_order_pricing_model',
    systemSortOrder: 'aG',
    showInPanel: false, // structure-only until the invoicing module (04-ui.md invoicing model)
    nullable: false,
    options: { options: [...WORK_ORDER_PRICING_MODEL_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true, // writable via API/quote-convert later; just never rendered yet
      updatable: true,
      configurable: false,
    },
    defaultValue: 'per_visit',
    description: 'How this job bills: each visit billed vs a fixed contract price',
  },

  invoiceTiming: {
    id: toFieldId('invoiceTiming'),
    key: 'invoiceTiming',
    label: 'Invoice Timing',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'work_order_invoice_timing',
    systemSortOrder: 'aH',
    showInPanel: true, // MI2: office can see/edit invoice timing in the drawer panel
    nullable: false,
    options: { options: [...WORK_ORDER_INVOICE_TIMING_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true, // writable via API/quote-convert later; just never rendered yet
      updatable: true,
      configurable: false,
    },
    defaultValue: 'per_visit_completed',
    description: 'When invoice drafts are generated (money MI2 build spec)',
  },

  quote: {
    id: toFieldId('quote'),
    key: 'quote',
    label: 'Quote',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'work_order_quote',
    systemSortOrder: 'aI',
    nullable: true,
    showInPanel: false, // drawer surfaces the quote via the Origin card, not a field row
    showInDialogs: false, // set by the convert flow, not picked in the new-job dialog
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'quote:workOrders' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'quote',
      relationshipType: 'belongs_to',
      inverseName: 'Work Orders',
      inverseSystemAttribute: 'quote_work_orders',
    },
    description: 'Quote this job was converted from',
  },

  // Reverse relationship: lineItems (from line_item.workOrder)
  lineItems: {
    id: toFieldId('lineItems'),
    key: 'lineItems',
    label: 'Line Items',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'work_order_line_items',
    systemSortOrder: 'aJ',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'line_item:workOrder' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Line items copied onto this job at convert time',
  },

  // Reverse relationship: invoices (from invoice.workOrder)
  invoices: {
    id: toFieldId('invoices'),
    key: 'invoices',
    label: 'Invoices',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'work_order_invoices',
    systemSortOrder: 'aK',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'invoice:workOrder' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Invoices gathered from this job',
  },

  // Inline TAGS field (option-backed, free-form multi-value — NOT the global Tag entity),
  // copying the `part.category` shape verbatim-adapted (parts v2 §C.1 recipe, route-planner
  // build contract item 10). Values live in `FieldValue.optionId`; options grow dynamically.
  // Narrows the route planner's map/backlog list by region (design doc decision #5).
  tags: {
    id: toFieldId('tags'),
    key: 'tags',
    label: 'Tags',
    type: BaseType.TAGS,
    fieldType: FieldType.TAGS,
    isSystem: true,
    systemAttribute: 'work_order_tags',
    systemSortOrder: 'aL',
    nullable: true,
    options: { options: [] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Add tags',
    description: 'Free-form tags (e.g. region) — narrows the route planner map and backlog list',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'b0',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the work order is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'b1',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the work order is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
