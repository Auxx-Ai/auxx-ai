// packages/lib/src/resources/registry/resources/vendor-bill-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Vendor Bill Line resource — one row per line on a
 * vendor's invoice (plans/purchasing/01-build-plan.md §5.2).
 *
 * Hidden system entity (`isVisible: false`), managed from the bill it belongs
 * to — the `subpart` / `vendor_part` precedent. It has no list of its own and
 * no detail page; a bill line only means anything beside its siblings.
 *
 * Every value here is TRANSCRIBED from the vendor's document rather than
 * derived. That is the point: `purchaseOrderLine` carries what we expected and
 * the receipts carry what arrived, so the match has three independent readings
 * to compare. Recomputing a line from the PO would collapse two of them into
 * one and there would be nothing left to disagree.
 */
export const VENDOR_BILL_LINE_FIELDS: Record<string, ResourceField> = {
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

  vendorBill: {
    id: toFieldId('vendorBill'),
    key: 'vendorBill',
    label: 'Vendor Bill',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_vendor_bill',
    systemSortOrder: 'a1',
    showInPanel: false, // lines are viewed in the context of their bill
    nullable: false,
    required: true,
    // Leg 1 of the natural key. A bill line has no identity of its own — the
    // vendor's line numbering is theirs and repeats across documents — so the
    // parent bill is the only stable half of it.
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_bill:lines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_bill',
      relationshipType: 'belongs_to',
      inverseName: 'Lines',
      inverseSystemAttribute: 'vendor_bill_lines',
    },
  },

  // THE MATCH KEY. Nullable, because a bill line with no PO line behind it is
  // legal (freight, a one-off, a line the vendor invented) — but where it IS
  // set, this edge is what lets the three-way match line up billed quantity and
  // price against ordered and received. Nothing else joins the three readings.
  purchaseOrderLine: {
    id: toFieldId('purchaseOrderLine'),
    key: 'purchaseOrderLine',
    label: 'Purchase Order Line',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_purchase_order_line',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'purchase_order_line:vendorBillLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'purchase_order_line',
      relationshipType: 'belongs_to',
      inverseName: 'Vendor Bill Lines',
      inverseSystemAttribute: 'purchase_order_line_vendor_bill_lines',
    },
  },

  // Stamped from the PO line at write, not hand-set — provenance and grouping
  // only. No inverse field is declared on `part`: `part_vendor_bill_lines` is
  // not a registered system attribute, so `linkNewRelationships` leaves this
  // edge one-way until one exists.
  part: {
    id: toFieldId('part'),
    key: 'part',
    label: 'Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_part',
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
      inverseResourceFieldId: 'part:vendorBillLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_description',
    systemSortOrder: 'a4',
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

  quantityBilled: {
    id: toFieldId('quantityBilled'),
    key: 'quantityBilled',
    label: 'Qty Billed',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_quantity_billed',
    systemSortOrder: 'a5',
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
    systemAttribute: 'vendor_bill_line_unit_price',
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
  },

  lineTotal: {
    id: toFieldId('lineTotal'),
    key: 'lineTotal',
    label: 'Line Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_line_total',
    systemSortOrder: 'a7',
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
  },

  // An account CODE — '2160', '5090' — never a provider account id (P2). The
  // ledger is ours and the accounting system is an exporter; the provider's id
  // for an account lives on `gl_account`, where it can change without touching
  // a single line.
  /**
   * The account this bill line is coded to, as a **CODE** (`'2160'`).
   *
   * 🛑 Deliberately NOT a role, and this is the one place in the purchasing
   * subsystem where a code is the right answer — so the difference from
   * `stock_movement.glAccount` (which stores a `G8` ROLE) is stated here rather
   * than left to be rediscovered.
   *
   * Two things separate them:
   *
   *  1. **This is the bookkeeper's own coding, against THEIR chart.** Most of a
   *     chart carries no auxx role at all — 16 of the 28 accounts in
   *     `DEFAULT_CHART_OF_ACCOUNTS` have none, and an org adds twenty more of
   *     its own on day one. A role-typed field could not express "code this
   *     line to 6410 Office Supplies", which is the ordinary case.
   *  2. **Nothing here is frozen history.** `updatable: true`: a bill line is a
   *     transcription of a document that a human corrects. The movement's role
   *     is frozen precisely because it can never be corrected.
   *
   * ⚠️ What is still wrong: `bill-lines-from-purchase-order.ts` hardcodes
   * `GRNI_ACCOUNT_CODE = '2160'` to prefill a PO-matched line. That IS a `G8`
   * violation — the prefill should resolve the `grni` role through the org's
   * own `gl_account` chart and use whatever code it finds. It is a prefill and
   * a human can overtype it, which is why it is a defect rather than a
   * corruption, but it breaks for any org that renumbers GRNI.
   */
  glAccount: {
    id: toFieldId('glAccount'),
    key: 'glAccount',
    label: 'GL Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_gl_account',
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '2160',
    description:
      "The account code this line is coded to, in the organization's own chart of accounts. A code, not an auxx posting role: most of a chart plays no part in an auxx posting.",
  },

  sortOrder: {
    id: toFieldId('sortOrder'),
    key: 'sortOrder',
    label: 'Sort Order',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_sort_order',
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
}
