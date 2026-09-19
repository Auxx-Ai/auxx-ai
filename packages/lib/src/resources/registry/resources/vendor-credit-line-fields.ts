// packages/lib/src/resources/registry/resources/vendor-credit-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { RATE_DECIMALS } from '@auxx/utils/currency'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { defineResourceFields } from '../system-attributes'

/**
 * Field definitions for the Vendor Credit Line resource — one row per credited
 * amount on a supplier's credit note (task 71 §5 U7).
 *
 * Hidden system entity, managed from the credit it belongs to, like
 * `vendor_bill_line`.
 *
 * 🛑 This is a **buy-side** line and carries `vendor_bill_line`'s shape, not the
 * credit memo line's: it names the GL account the original charge was coded to,
 * as an id. There is no tax field — tax and freight are their own coded lines,
 * for the same reason a vendor bill's are.
 */
export const VENDOR_CREDIT_LINE_FIELDS = defineResourceFields({
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
  },

  vendorCredit: {
    id: toFieldId('vendorCredit'),
    key: 'vendorCredit',
    label: 'Vendor Credit',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_credit_line_vendor_credit',
    systemSortOrder: 'a1',
    showInPanel: false,
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_credit:lines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_credit',
      relationshipType: 'belongs_to',
      inverseName: 'Lines',
      inverseSystemAttribute: 'vendor_credit_lines',
    },
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_credit_line_description',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter description',
  },

  quantity: {
    id: toFieldId('quantity'),
    key: 'quantity',
    label: 'Qty',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'vendor_credit_line_quantity',
    systemSortOrder: 'a3',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: 1,
  },

  unitPrice: {
    id: toFieldId('unitPrice'),
    key: 'unitPrice',
    label: 'Unit Price',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_credit_line_unit_price',
    systemSortOrder: 'a4',
    nullable: true,
    // RATE, not amount: per-each, like `vendor_bill_line_unit_price`.
    options: {
      currencyCode: 'USD',
      decimals: RATE_DECIMALS,
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
  },

  lineTotal: {
    id: toFieldId('lineTotal'),
    key: 'lineTotal',
    label: 'Line Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_credit_line_line_total',
    systemSortOrder: 'a5',
    nullable: true,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  /**
   * The account this credit line reverses, as an **ID** in the org's own chart
   * — the same decision as `vendor_bill_line_gl_account`, and for the same
   * reason: most of a chart carries no auxx role, and this is the bookkeeper's
   * own coding.
   *
   * A credit raised against a PO-backed bill is prefilled with the org's
   * resolved `grni` account (through `resolveRoles`, never a hardcoded code),
   * so `Dr A/P / Cr GRNI` is this entry with that account on the line. The
   * person may recode it.
   */
  glAccount: {
    id: toFieldId('glAccount'),
    key: 'glAccount',
    label: 'GL Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_credit_line_gl_account',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select account',
    description:
      "The gl_account id this line is coded to, in the organization's own chart of accounts. " +
      'TEXT with no foreign key, not a code and not an auxx posting role.',
  },

  // Provenance and grouping only, like `vendor_bill_line_part`. One-way: no
  // inverse is declared on `part`, so `linkNewRelationships` leaves the edge
  // one-sided rather than creating a half nothing reads.
  part: {
    id: toFieldId('part'),
    key: 'part',
    label: 'Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_credit_line_part',
    systemSortOrder: 'a7',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: null,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
  },

  // Which ordered line the credit is against, when the supplier said. One-way
  // for the same reason as `part` above.
  purchaseOrderLine: {
    id: toFieldId('purchaseOrderLine'),
    key: 'purchaseOrderLine',
    label: 'Purchase Order Line',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_credit_line_purchase_order_line',
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
      inverseResourceFieldId: null,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
  },

  sortOrder: {
    id: toFieldId('sortOrder'),
    key: 'sortOrder',
    label: 'Sort Order',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'vendor_credit_line_sort_order',
    systemSortOrder: 'a9',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
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
  },

  createdBy: CREATED_BY_FIELD,
})
