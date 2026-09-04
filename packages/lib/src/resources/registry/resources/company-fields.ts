// packages/lib/src/resources/registry/resources/company-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * IRS Form W-9 tax classification (plans/accounting/HANDOFF.md slot 2K).
 * The six boxes Form W-9 §3 offers a US vendor - kept as a plain SINGLE_SELECT
 * rather than an `enum-values.ts` entry because every other company option list
 * (industry, company size, enrichment status) is declared inline in this file.
 */
const COMPANY_TAX_CLASSIFICATION_OPTIONS = [
  { label: 'Individual / sole proprietor', value: 'individual_sole_proprietor', color: 'gray' },
  { label: 'C corporation', value: 'c_corporation', color: 'blue' },
  { label: 'S corporation', value: 's_corporation', color: 'purple' },
  { label: 'Partnership', value: 'partnership', color: 'orange' },
  { label: 'LLC', value: 'llc', color: 'teal' },
  { label: 'Other', value: 'other', color: 'gray' },
] as const

/**
 * IRS Form 1099 box a vendor's payments default to when the year-end summary
 * groups them (`postings/reports/vendor-1099.ts`). `none` is the default so an
 * eligible-but-unmapped vendor is visibly unmapped rather than silently
 * defaulting into NEC.
 */
const COMPANY_DEFAULT_1099_BOX_OPTIONS = [
  { label: 'None', value: 'none', color: 'gray' },
  { label: '1099-NEC Box 1 - Nonemployee compensation', value: 'nec_1', color: 'blue' },
  { label: '1099-MISC Box 1 - Rents', value: 'misc_1_rents', color: 'purple' },
  { label: '1099-MISC Box 3 - Other income', value: 'misc_3_other', color: 'orange' },
] as const

/**
 * Field definitions for the Company resource
 * Defines all fields, their types, capabilities, and validation rules
 */
export const COMPANY_FIELDS: Record<string, ResourceField> = {
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
    operatorOverrides: ['is', 'is not', 'in', 'not in'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique company identifier',
  },

  companyName: {
    id: toFieldId('companyName'),
    key: 'companyName',
    label: 'Company Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'company_name',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Enter company name',
  },

  logo: {
    id: toFieldId('logo'),
    key: 'logo',
    label: 'Logo',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'company_logo',
    systemSortOrder: 'a2',
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
  },

  website: {
    id: toFieldId('website'),
    key: 'website',
    label: 'Website',
    type: BaseType.URL,
    fieldType: FieldType.URL,
    isSystem: true,
    systemAttribute: 'company_website',
    systemSortOrder: 'a3',
    nullable: true,
    // Multi-value: a company can hold several site URLs; the first (by
    // sortKey) is the primary. Existing orgs are caught up by data
    // migration 085.
    options: { multi: true },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter website URL',
  },

  companyDomain: {
    id: toFieldId('companyDomain'),
    key: 'companyDomain',
    label: 'Domain',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'company_domain',
    systemSortOrder: 'a3a',
    nullable: true,
    showInPanel: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'acme.com',
    description: 'Registrable domain used to auto-link contacts by email. Unique per organization.',
  },

  xFollowerCount: {
    id: toFieldId('xFollowerCount'),
    key: 'xFollowerCount',
    label: 'X Followers',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'company_x_follower_count',
    systemSortOrder: 'a3c',
    showInTable: false, // panel shows it; hidden from the default table columns
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter X follower count',
  },

  industry: {
    id: toFieldId('industry'),
    key: 'industry',
    label: 'Industry',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'company_industry',
    systemSortOrder: 'a4',
    nullable: true,
    options: {
      options: [
        { label: 'E-commerce', value: 'e-commerce', color: 'blue' },
        { label: 'SaaS', value: 'saas', color: 'purple' },
        { label: 'Retail', value: 'retail', color: 'green' },
        { label: 'Manufacturing', value: 'manufacturing', color: 'orange' },
        { label: 'Wholesale', value: 'wholesale', color: 'amber' },
        { label: 'Other', value: 'other', color: 'gray' },
      ],
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select industry',
  },

  companySize: {
    id: toFieldId('companySize'),
    key: 'companySize',
    label: 'Company Size',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'company_size',
    systemSortOrder: 'a5',
    nullable: true,
    options: {
      options: [
        { label: '1-10', value: '1-10', color: 'gray' },
        { label: '11-50', value: '11-50', color: 'blue' },
        { label: '51-200', value: '51-200', color: 'green' },
        { label: '201-500', value: '201-500', color: 'orange' },
        { label: '500+', value: '500+', color: 'red' },
      ],
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select company size',
  },

  annualRevenue: {
    id: toFieldId('annualRevenue'),
    key: 'annualRevenue',
    label: 'Annual Revenue',
    type: BaseType.NUMBER,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'company_annual_revenue',
    systemSortOrder: 'a6',
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
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter annual revenue',
  },

  fundingRaised: {
    id: toFieldId('fundingRaised'),
    key: 'fundingRaised',
    label: 'Funding Raised',
    type: BaseType.NUMBER,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'company_funding_raised',
    systemSortOrder: 'a6a',
    showInPanel: false, // excluded from both the panel and table default views
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
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter total funding raised',
  },

  founded: {
    id: toFieldId('founded'),
    key: 'founded',
    label: 'Founded',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'company_founded',
    systemSortOrder: 'a7',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  headquarters: {
    id: toFieldId('headquarters'),
    key: 'headquarters',
    label: 'Headquarters',
    type: BaseType.OBJECT,
    fieldType: FieldType.ADDRESS_STRUCT,
    isSystem: true,
    systemAttribute: 'company_headquarters',
    systemSortOrder: 'a8',
    nullable: true,
    options: {
      addressComponents: ['street', 'city', 'state', 'country'],
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  notes: {
    id: toFieldId('notes'),
    key: 'notes',
    label: 'Notes',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'company_notes',
    systemSortOrder: 'a9',
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

  primaryContact: {
    id: toFieldId('primaryContact'),
    key: 'primaryContact',
    label: 'Primary Contact',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'company_primary_contact',
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
      inverseResourceFieldId: 'contact:company' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    description: 'Primary contact person at this company',
  },

  employees: {
    id: toFieldId('employees'),
    key: 'employees',
    label: 'Employees',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'company_employees',
    systemSortOrder: 'aB',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'contact:employer' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: false,
    },
    description: 'Employees associated with this company',
  },

  // Reverse relationship: vendorParts (one-to-many from vendor_part.contact)
  vendorParts: {
    id: toFieldId('vendorParts'),
    key: 'vendorParts',
    label: 'Supplier Parts',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'company_vendor_parts',
    systemSortOrder: 'aCa',
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
    description: 'Parts this company supplies',
  },

  // Reverse relationship: products (one-to-many from product.vendor)
  products: {
    id: toFieldId('products'),
    key: 'products',
    label: 'Products',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'company_products',
    systemSortOrder: 'aCd',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'product:vendor' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Product families this company is the vendor of',
  },

  meetings: {
    id: toFieldId('meetings'),
    key: 'meetings',
    label: 'Meetings',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'company_meetings',
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
      inverseResourceFieldId: 'meeting:company' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Meetings associated with this company',
  },

  enrichedAt: {
    id: toFieldId('enrichedAt'),
    key: 'enrichedAt',
    label: 'Enriched At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'company_enriched_at',
    systemSortOrder: 'aY',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      // Written by the enrichment job only. The write path does not read this
      // flag, so the backend keeps writing — it is the UI surfaces that honour
      // it. `hidden` already keeps the field off every surface; this makes the
      // declaration true so unhiding it later cannot silently make it editable.
      updatable: false,
      configurable: false,
      hidden: true,
    },
    description: 'When this company was last enriched from its website.',
  },

  enrichmentStatus: {
    id: toFieldId('enrichmentStatus'),
    key: 'enrichmentStatus',
    label: 'Enrichment Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'company_enrichment_status',
    systemSortOrder: 'aZ',
    nullable: true,
    options: {
      options: [
        { label: 'Pending', value: 'pending', color: 'gray' },
        { label: 'Enriched', value: 'enriched', color: 'green' },
        { label: 'Failed', value: 'failed', color: 'red' },
        { label: 'Skipped', value: 'skipped', color: 'amber' },
      ],
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      // Backend-owned lifecycle marker — see `enrichedAt` above.
      updatable: false,
      configurable: false,
      hidden: true,
    },
    description: 'Enrichment lifecycle marker.',
  },

  firstInteractionAt: {
    id: toFieldId('firstInteractionAt'),
    key: 'firstInteractionAt',
    label: 'First interaction',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'first_interaction_at',
    systemSortOrder: 'aCb',
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
    description:
      'Oldest real correspondence with this company (message time, propagated from contacts)',
  },

  lastInteractionAt: {
    id: toFieldId('lastInteractionAt'),
    key: 'lastInteractionAt',
    label: 'Last interaction',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'last_interaction_at',
    systemSortOrder: 'aCc',
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
    description:
      'Newest real correspondence with this company (message time, propagated from contacts)',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'aD',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when company is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'aE',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when company is modified',
  },

  // Reverse relationship: workOrders (from work_order.company)
  workOrders: {
    id: toFieldId('workOrders'),
    key: 'workOrders',
    label: 'Work Orders',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'company_work_orders',
    showInPanel: false,
    systemSortOrder: 'aF',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'work_order:company' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Work orders for this company',
  },

  // Reverse relationship: orders (from order.company)
  orders: {
    id: toFieldId('orders'),
    key: 'orders',
    label: 'Orders',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'company_orders',
    showInPanel: false,
    systemSortOrder: 'aG',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'order:company' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Orders placed by this company',
  },

  // Reverse relationship: purchaseOrders (from purchase_order.vendor)
  purchaseOrders: {
    id: toFieldId('purchaseOrders'),
    key: 'purchaseOrders',
    label: 'Purchase Orders',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'company_purchase_orders',
    showInPanel: false,
    systemSortOrder: 'c0',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'purchase_order:vendor' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Purchase orders raised on this supplier',
  },

  // Reverse relationship: vendorBills (from vendor_bill.vendor)
  vendorBills: {
    id: toFieldId('vendorBills'),
    key: 'vendorBills',
    label: 'Vendor Bills',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'company_vendor_bills',
    showInPanel: false,
    systemSortOrder: 'c1',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_bill:vendor' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Bills received from this supplier',
  },

  // Reverse relationship: vendorPayments (from vendor_payment.vendor)
  vendorPayments: {
    id: toFieldId('vendorPayments'),
    key: 'vendorPayments',
    label: 'Vendor Payments',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'company_vendor_payments',
    showInPanel: false,
    systemSortOrder: 'c2',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_payment:vendor' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Payments made to this supplier',
  },

  // ── 1099 / W-9 (plans/accounting/HANDOFF.md slot 2K, added by entity
  // migration 125) ───────────────────────────────────────────────────────

  taxClassification: {
    id: toFieldId('taxClassification'),
    key: 'taxClassification',
    label: 'Tax Classification',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'company_tax_classification',
    systemSortOrder: 'c3',
    nullable: true,
    options: { options: [...COMPANY_TAX_CLASSIFICATION_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select tax classification',
    description: "The vendor's Form W-9 §3 tax classification.",
  },

  tin: {
    id: toFieldId('tin'),
    key: 'tin',
    label: 'TIN',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'company_tin',
    systemSortOrder: 'c4',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'XX-XXXXXXX',
    // 🛑 No masking mechanism exists in the registry today: `ResourceField`'s
    // `capabilities` carry no `sensitive`/`mask` flag anywhere in this repo
    // (checked - grep turns up nothing). This is a plain TEXT field; masking
    // the SSN/EIN in the company drawer is left to the drawer UI, which is not
    // this slot's file. Flagged in the 2K report rather than left silent.
    description:
      "The vendor's taxpayer identification number (SSN or EIN), from Form W-9. " +
      'Not filterable - a TIN is never a lookup key. Should be masked on display; ' +
      'no masking capability exists in the field registry yet.',
  },

  w9OnFile: {
    id: toFieldId('w9OnFile'),
    key: 'w9OnFile',
    label: 'W-9 On File',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'company_w9_on_file',
    systemSortOrder: 'c5',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: false,
    description: 'Whether a completed Form W-9 has been collected from this vendor.',
  },

  is1099Eligible: {
    id: toFieldId('is1099Eligible'),
    key: 'is1099Eligible',
    label: '1099 Eligible',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'company_is_1099_eligible',
    systemSortOrder: 'c6',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: false,
    description:
      'Whether this vendor is a candidate for a 1099 - a US non-corporate contractor paid ' +
      'for services. The year-end summary further filters on the $600 threshold.',
  },

  default1099Box: {
    id: toFieldId('default1099Box'),
    key: 'default1099Box',
    label: 'Default 1099 Box',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'company_default_1099_box',
    systemSortOrder: 'c7',
    nullable: true,
    options: { options: [...COMPANY_DEFAULT_1099_BOX_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select 1099 box',
    defaultValue: 'none',
    description: "Which 1099 box this vendor's payments are reported under by default.",
  },

  createdBy: CREATED_BY_FIELD,
}
