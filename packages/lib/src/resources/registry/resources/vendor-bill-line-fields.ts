// packages/lib/src/resources/registry/resources/vendor-bill-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { RATE_DECIMALS } from '@auxx/utils/currency'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { defineResourceFields } from '../system-attributes'

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
export const VENDOR_BILL_LINE_FIELDS = defineResourceFields({
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

  /**
   * The goods bill a LANDED-COST line belongs to — a carrier's freight line or
   * a broker's duty line, naming the shipment it was charged against (73 §7.2).
   *
   * The bill and not the order: duty is assessed per customs entry, a vendor
   * invoices per shipment, and the broker's document lists the commercial
   * invoice numbers, which are the vendor invoice numbers on the goods bills.
   * A line carrying this has no `purchaseOrderLine`, so the three-way match
   * skips it exactly as it skips any other unlinked line.
   */
  landedBill: {
    id: toFieldId('landedBill'),
    key: 'landedBill',
    label: 'Landed Cost For',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_landed_bill',
    systemSortOrder: 'a2a',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_bill:landedCostLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'vendor_bill',
      relationshipType: 'belongs_to',
      inverseName: 'Landed Cost Lines',
      inverseSystemAttribute: 'vendor_bill_landed_cost_lines',
    },
    description:
      "The goods bill this freight or duty line was charged against. The vendor's own shipment, " +
      'not the purchase order: customs assesses one entry per shipment.',
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

  // The strongest match signal a line has — the vendor's own code for it, as
  // printed on their invoice. Never the part's SKU: this is what the matcher
  // reads (plans/money/tasks/58-vendor-bill-from-the-invoice.md §7.1), and the
  // bill-side twin of the quote intake's write-back to `vendor_part.vendorSku`.
  vendorCode: {
    id: toFieldId('vendorCode'),
    key: 'vendorCode',
    label: 'Vendor Code',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'vendor_bill_line_vendor_code',
    systemSortOrder: 'a4a',
    nullable: true,
    showInTable: false,
    showInPanel: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      "The vendor's own code for this line as printed on their invoice. What the matcher reads, never the part's SKU.",
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
    // RATE, not amount: per-each (plans/money/tasks/31-sub-cent-rates.md §2.2).
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

  // The `gl_account` instance id (task 15 §4) - a text id with no foreign
  // key, never a provider account id (P2). The ledger is ours and the
  // accounting system is an exporter; the provider's id for an account lives
  // on `gl_account`, where it can change without touching a single line.
  /**
   * The account this bill line is coded to, as an **ID**, not a code and not
   * a role.
   *
   * 🛑 Deliberately NOT a role, and this is the one place in the purchasing
   * subsystem where a bookkeeper's own pick is the right answer - so the
   * difference from `stock_movement.glAccount` (which stores a `G8` ROLE) is
   * stated here rather than left to be rediscovered.
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
   * `id as TEXT, no FK, validated on read` is the decision
   * (`plans/accounting/tasks/done/15-the-account-id-is-the-identity.md` §4) - the
   * same shape `GlRoleAssignment.glAccountId` already uses.
   *
   * A LINKED line no longer reads this at all: 73 D2 posts it to `grni` off the
   * role, so `bill-lines-from-purchase-order.ts` leaves it blank rather than
   * prefilling an account.
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
    placeholder: 'Select account',
    description:
      "The gl_account id this line is coded to, in the organization's own chart of accounts. TEXT with no foreign key, not a code and not an auxx posting role: most of a chart plays no part in an auxx posting.",
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
})
