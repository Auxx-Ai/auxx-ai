// packages/lib/src/resources/registry/resources/quote-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/** Quote lifecycle status (README §domain, money MQ1 build spec §B.1). */
const QUOTE_STATUS_OPTIONS = [
  { label: 'Draft', value: 'draft', color: 'gray' },
  { label: 'Sent', value: 'sent', color: 'blue' },
  { label: 'Approved', value: 'approved', color: 'green' },
  { label: 'Declined', value: 'declined', color: 'red' },
  { label: 'Canceled', value: 'canceled', color: 'gray' },
] as const

/**
 * How this quote bills — same shape as `WORK_ORDER_PRICING_MODEL_OPTIONS`
 * (not exported from work-order-fields.ts, so duplicated here). Copied onto
 * the work order at convert time (§F.4).
 */
const QUOTE_PRICING_MODEL_OPTIONS = [
  { label: 'Per visit', value: 'per_visit', color: 'blue' },
  { label: 'Fixed price', value: 'fixed', color: 'purple' },
] as const

/**
 * When invoice drafts are generated — same shape as
 * `WORK_ORDER_INVOICE_TIMING_OPTIONS` (not exported, so duplicated here).
 */
const QUOTE_INVOICE_TIMING_OPTIONS = [
  { label: 'After each visit', value: 'per_visit_completed', color: 'blue' },
  { label: 'When job completes', value: 'on_completion', color: 'green' },
  { label: 'As needed', value: 'as_needed', color: 'gray' },
  { label: 'Custom schedule', value: 'custom_schedule', color: 'amber' },
] as const

/** Percent-of-subtotal vs flat-amount discount. */
const QUOTE_DISCOUNT_TYPE_OPTIONS = [
  { label: 'Percent', value: 'percent', color: 'blue' },
  { label: 'Amount', value: 'amount', color: 'purple' },
] as const

/**
 * Field definitions for the Quote resource (money MQ1, README).
 * The first pure-EntityInstance system def with `hasDetailPage: true`.
 */
export const QUOTE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique quote identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'quote_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // hook-generated (§E.2) — the hook is the ONLY writer
      updatable: false,
      configurable: false,
    },
    description: 'Auto-generated quote number',
  },

  title: {
    id: toFieldId('title'),
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'quote_title',
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
    placeholder: 'Enter quote title',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'quote_status',
    systemSortOrder: 'a3',
    nullable: false,
    options: { options: [...QUOTE_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'draft',
  },

  contact: {
    id: toFieldId('contact'),
    key: 'contact',
    label: 'Contact',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'quote_contact',
    systemSortOrder: 'a4',
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
      inverseResourceFieldId: 'contact:quotes' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'contact',
      relationshipType: 'belongs_to',
      inverseName: 'Quotes',
      inverseSystemAttribute: 'contact_quotes',
    },
    description: 'Customer contact for this quote — carries the customer info',
  },

  request: {
    id: toFieldId('request'),
    key: 'request',
    label: 'Service Request',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'quote_request',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'service_request:quotes' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'service_request',
      relationshipType: 'belongs_to',
      inverseName: 'Quotes',
      inverseSystemAttribute: 'service_request_quotes',
    },
    description: 'Service request this quote was created from',
  },

  validUntil: {
    id: toFieldId('validUntil'),
    key: 'validUntil',
    label: 'Valid Until',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'quote_valid_until',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select expiration date',
    description: 'Expired badge derives from this (UI-side) — never a status',
  },

  pricingModel: {
    id: toFieldId('pricingModel'),
    key: 'pricingModel',
    label: 'Pricing Model',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'quote_pricing_model',
    systemSortOrder: 'a7',
    nullable: false,
    options: { options: [...QUOTE_PRICING_MODEL_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select pricing model',
    defaultValue: 'per_visit',
    description: 'How this job bills — copied onto the work order at convert time',
  },

  invoiceTiming: {
    id: toFieldId('invoiceTiming'),
    key: 'invoiceTiming',
    label: 'Invoice Timing',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'quote_invoice_timing',
    systemSortOrder: 'a8',
    nullable: false,
    options: { options: [...QUOTE_INVOICE_TIMING_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select invoice timing',
    defaultValue: 'per_visit_completed',
    description: 'When invoice drafts are generated — copied onto the work order at convert time',
  },

  discountType: {
    id: toFieldId('discountType'),
    key: 'discountType',
    label: 'Discount Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'quote_discount_type',
    systemSortOrder: 'a9',
    nullable: true,
    options: { options: [...QUOTE_DISCOUNT_TYPE_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select discount type',
    description: 'Null = no discount',
  },

  discountValue: {
    id: toFieldId('discountValue'),
    key: 'discountValue',
    label: 'Discount Value',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'quote_discount_value',
    systemSortOrder: 'aA',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  taxName: {
    id: toFieldId('taxName'),
    key: 'taxName',
    label: 'Tax Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'quote_tax_name',
    systemSortOrder: 'aB',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: "Snapshot of the picked tax rate's name (documents.taxRates)",
  },

  taxRate: {
    id: toFieldId('taxRate'),
    key: 'taxRate',
    label: 'Tax Rate',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'quote_tax_rate',
    systemSortOrder: 'aC',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Snapshot of the picked tax rate, percent (e.g. 7.5)',
  },

  subtotal: {
    id: toFieldId('subtotal'),
    key: 'subtotal',
    label: 'Subtotal',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'quote_subtotal',
    systemSortOrder: 'aD',
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // totals engine (§F) is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Sum of line totals — written by the totals engine hook',
  },

  taxTotal: {
    id: toFieldId('taxTotal'),
    key: 'taxTotal',
    label: 'Tax Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'quote_tax_total',
    systemSortOrder: 'aE',
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // totals engine (§F) is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Written by the totals engine hook',
  },

  total: {
    id: toFieldId('total'),
    key: 'total',
    label: 'Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'quote_total',
    systemSortOrder: 'aF',
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // totals engine (§F) is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Written by the totals engine hook',
  },

  notes: {
    id: toFieldId('notes'),
    key: 'notes',
    label: 'Notes',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'quote_notes',
    systemSortOrder: 'aG',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter internal notes',
    description: 'Internal notes — not shown to the customer',
  },

  terms: {
    id: toFieldId('terms'),
    key: 'terms',
    label: 'Terms',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'quote_terms',
    systemSortOrder: 'aH',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter customer-facing terms',
    description: 'Customer-facing terms (plain text, PDF-friendly)',
  },

  pdfAsset: {
    id: toFieldId('pdfAsset'),
    key: 'pdfAsset',
    label: 'PDF Asset',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'quote_pdf_asset',
    systemSortOrder: 'aK',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true,
      configurable: false,
      hidden: true,
    },
    description:
      'MediaAsset id of the last-rendered quote PDF (money MQ2 build spec §C.1) — written ' +
      'only by ensureQuotePdf via FieldValueService, never user-editable',
  },

  lineItems: {
    id: toFieldId('lineItems'),
    key: 'lineItems',
    label: 'Line Items',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'quote_line_items',
    systemSortOrder: 'aI',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'line_item:quote' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Line items on this quote',
  },

  workOrders: {
    id: toFieldId('workOrders'),
    key: 'workOrders',
    label: 'Work Orders',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'quote_work_orders',
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
      inverseResourceFieldId: 'work_order:quote' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Work orders converted from this quote',
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
    description: 'Automatically set when the quote is created',
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
    description: 'Automatically updated when the quote is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
